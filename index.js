/* ====== CONFIG ====== */
const ROUTE_URL = "route.gpx";         // stitched continuous GPX
const PRE_DECIMATE_METERS = 5;         // quick dedupe before simplification
const SNAP_TOL_METERS = 20;            // smaller = curvier

/* ====== DOM ====== */
const mapEl = document.getElementById("map");
const sidebar = document.getElementById("sidebar");
const openBtn = document.getElementById("open-sidebar");

const sectionsListEl = document.getElementById("sections-list");
const sectionsCountEl = document.getElementById("sections-count");
const filterVideosEl = document.getElementById("filter-videos");
const overallStatsEl = document.getElementById("overall-stats");
const walkersAvatarsEl = document.getElementById("walkers-avatars");
const sortModeEl = document.getElementById("sort-mode");
const activeFilterEl = document.getElementById("active-filter");

let rafRefresh = null;
let lastCorridor = null;
let hoverPopup = null;

/* ====== Walker filtering state ====== */
const WALKER_NAMES = { charlie: "Charlie", olly: "Olly", dad: "Dad" };
let selectedWalker = null;   // pinned filter (null = everyone); drives list + stats + map
let hoverWalker = null;      // transient hover preview; drives map only
let sortMode = "trip";       // "trip" (grouped) | "recent" (flat, newest first)

/* ====== MAP ====== */
const canvasRenderer = L.canvas({ padding: 0.5 });
const map = L.map(mapEl, { attributionControl: false, preferCanvas: true, zoomControl: false }).setView([50.7, -3.5], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);
// Labels-on-top pane: sits above the route corridors so place names stay readable
map.createPane("labels");
map.getPane("labels").style.zIndex = 650;
map.getPane("labels").style.pointerEvents = "none";
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    pane: "labels",
    maxZoom: 19,
}).addTo(map);
L.control.attribution({ position: "topright" }).addTo(map);

/* ====== HELPERS ====== */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const makeId = s => `${slug(s.start)}_to_${slug(s.end)}_${s.date || "nodate"}`;
const toLngLat = ([lat, lng]) => [lng, lat];
const toLatLng = ([lng, lat]) => [lat, lng];
const coordsToLatLngs = coords => coords.map(toLatLng);
const metersToDegrees = m => m / 111320;

function relativeTime(dateStr) {
    if (!dateStr) return "";
    const days = Math.floor((new Date() - new Date(dateStr)) / 86400000);
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    const y = Math.floor(days / 365);
    const m = Math.floor((days % 365) / 30);
    return m > 0 ? `${y}y ${m}mo ago` : `${y}y ago`;
}

function ageColor(dateStr) {
    if (!dateStr) return "#ddd";
    const days = Math.floor((new Date() - new Date(dateStr)) / 86400000);
    if (days < 365) return "#22c55e";
    if (days < 730) return "#3b82f6";
    if (days < 1095) return "#f59e0b";
    return "#9ca3af";
}

function walkerNames(s) {
    const names = [];
    if (s.charlie) names.push("Charlie");
    if (s.olly) names.push("Olly");
    if (s.dad) names.push("Dad");
    return names.join(", ");
}

function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [intervals[0].slice()];
    for (let i = 1; i < intervals.length; i++) {
        const last = merged[merged.length - 1];
        if (intervals[i][0] <= last[1]) {
            last[1] = Math.max(last[1], intervals[i][1]);
        } else {
            merged.push(intervals[i].slice());
        }
    }
    return merged;
}

// RGB for rgba()
const RGB = {
    charlie: [220, 38, 38],   // red-600
    olly: [37, 99, 235],   // blue-600
    dad: [22, 163, 74],   // green-600
};
const rgba = (who, a) => `rgba(${RGB[who][0]},${RGB[who][1]},${RGB[who][2]},${a})`;

function approxMeters([lon1, lat1], [lon2, lat2]) {
    const R = 6371000;
    const x = (lon2 - lon1) * Math.cos((lat1 + lat2) * Math.PI / 360) * Math.PI / 180;
    const y = (lat2 - lat1) * Math.PI / 180;
    return Math.hypot(x * R, y * R);
}

function preDecimate(lonlat, minMeters = PRE_DECIMATE_METERS) {
    if (lonlat.length <= 2) return lonlat;
    const out = [];
    let last = lonlat[0];
    out.push(last);
    for (let i = 1; i < lonlat.length; i++) {
        const p = lonlat[i];
        if (p[0] === last[0] && p[1] === last[1]) continue;
        if (approxMeters(last, p) >= minMeters) { out.push(p); last = p; }
    }
    if (out[out.length - 1] !== lonlat[lonlat.length - 1]) out.push(lonlat[lonlat.length - 1]);
    return out;
}

/* Pixel-space lateral offset for stable separation at any zoom */
function offsetByPixels(latlngs, px) {
    if (Math.abs(px) < 0.5 || latlngs.length < 2) return latlngs.slice();
    const out = [];
    for (let i = 0; i < latlngs.length; i++) {
        const prev = latlngs[i - 1] || latlngs[i];
        const next = latlngs[i + 1] || latlngs[i];
        const P = map.latLngToLayerPoint(prev);
        const C = map.latLngToLayerPoint(latlngs[i]);
        const N = map.latLngToLayerPoint(next);
        const vx = N.x - P.x, vy = N.y - P.y;
        const nx = -vy, ny = vx;
        const norm = Math.hypot(nx, ny) || 1;
        const ox = (nx / norm) * px;
        const oy = (ny / norm) * px;
        const shifted = L.point(C.x + ox, C.y + oy);
        out.push(map.layerPointToLatLng(shifted));
    }
    return out;
}

/* ====== ROUTE (continuous GPX) ====== */
let ROUTE = null;         // Feature<LineString> simplified for snapping/slicing
let ROUTE_MILES = 630;    // recomputed from ROUTE length

async function loadRouteFromContinuousGPX() {
    const res = await fetch(ROUTE_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error("route.gpx not found");
    const xml = new DOMParser().parseFromString(await res.text(), "application/xml");

    const pts = Array.from(xml.getElementsByTagName("trkpt"))
        .map(pt => [parseFloat(pt.getAttribute("lon")), parseFloat(pt.getAttribute("lat"))])
        .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

    if (pts.length < 2) throw new Error("GPX has too few points.");

    const dec = preDecimate(pts, PRE_DECIMATE_METERS);
    const tol = metersToDegrees(SNAP_TOL_METERS);
    ROUTE = turf.simplify(turf.lineString(dec), { tolerance: tol, highQuality: false, mutate: false });
    ROUTE_MILES = Math.round(turf.length(ROUTE, { units: "miles" }));
}

/* Slice on the continuous route (tries both directions) */
function sliceOnRoute(startLatLng, endLatLng) {
    const a = turf.nearestPointOnLine(ROUTE, toLngLat(startLatLng));
    const b = turf.nearestPointOnLine(ROUTE, toLngLat(endLatLng));
    let seg = turf.lineSlice(a, b, ROUTE);
    if (!seg || !seg.geometry || seg.geometry.coordinates.length < 2) seg = turf.lineSlice(b, a, ROUTE);

    const km = turf.length(seg, { units: "kilometers" });
    const latlngs = coordsToLatLngs(seg.geometry.coordinates);
    const startKm = Math.min(a.properties.location, b.properties.location);
    const endKm = Math.max(a.properties.location, b.properties.location);
    return { latlngs, km, startKm, endKm };
}

/* ====== DATA FROM NEW trips-based HIKE_DATA ====== */
let TRIPS = [];                 // [{ name, year, sections:[...] }]
let YEAR_GROUPS = [];           // [{ year, trips:[...] }]
let SECTIONS_MAP = new Map();   // id -> section object
let LINES = new Map();          // id -> { byWalker, bounds }
let MARKERS = new Map();        // id -> [L.marker, ...] (start, and end if fixEnd)
let SECTION_ELEMENT = new Map();// id -> <li> element

function buildFromTrips() {
    TRIPS = [];
    YEAR_GROUPS = [];
    SECTIONS_MAP.clear();

    HIKE_DATA.forEach(trip => {
        const list = [];
        (trip.sections || []).forEach(item => {
            const tookPart = !!(item.charlie || item.olly || item.dad);
            if (!tookPart) return;

            const { latlngs, km, startKm, endKm } = sliceOnRoute(item.startCoords, item.endCoords);
            const miles = km * 0.621371;
            const id = makeId(item);
            const year = item.date ? new Date(item.date).getFullYear() : null;
            const sec = {
                id, year,
                tripName: trip.name,
                start: item.start, end: item.end,
                startCoords: item.startCoords, endCoords: item.endCoords,
                direction: item.direction,
                latlngs, km, miles, startKm, endKm,
                charlie: !!item.charlie, olly: !!item.olly, dad: !!item.dad,
                videoLink: item.videoLink || "",
                date: item.date || "",
                fixEnd: !!item.fixEnd,
            };
            list.push(sec);
            SECTIONS_MAP.set(id, sec);
        });

        if (list.length) {
            const firstWithDate = list.find(s => s.year);
            const year = firstWithDate ? firstWithDate.year : "";
            TRIPS.push({ name: trip.name, year, sections: list });
        }
    });

    // group by year, newest first
    const byYear = new Map();
    TRIPS.forEach(t => {
        const y = t.year || "Unknown";
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(t);
    });
    YEAR_GROUPS = Array.from(byYear.entries())
        .sort((a, b) => -(b[0] + "").localeCompare(a[0] + ""))  // desc
        .map(([year, trips]) => ({ year, trips }));
}

/* ====== DRAW LINES ====== */
let NEWEST_YEAR = null;

function computeNewestYear() {
    let maxY = null;
    TRIPS.forEach(trip => trip.sections.forEach(s => {
        if (s.year && (maxY === null || s.year > maxY)) maxY = s.year;
    }));
    NEWEST_YEAR = maxY;
}

/* opacity gets a tiny reduction for older years (min 0.6) */
function yearOpacity(year) {
    return 1
}

function getWalkerWeight() {
    const z = map.getZoom();
    if (z <= 9) return 500;
    if (z <= 12) return 150;
    // Above zoom 12, shrink the corridor so lines thin out on screen.
    // Factor 0.4 per zoom level → pixel width shrinks ~0.8× per zoom step
    // (mpp halves each zoom, 0.4/0.5 = 0.8), giving a gentle decrease.
    return 150 * Math.pow(0.4, z - 12);
}


function makeWalkerLine(latlngs, who, year) {
    return L.corridor(latlngs, {
        color: rgba(who, yearOpacity(year)), // paler for older years
        corridor: getWalkerWeight(),
        opacity: 1,
        lineCap: "round",
        renderer: canvasRenderer,
        smoothFactor: 1,
    }).addTo(map);
}

/* separation in pixels – tuned so it stays apart even when zoomed way out */
function separationPX() {
    const z = map.getZoom();
    return getWalkerWeight() * 2 / getMetersPerPixel(map);
}



function drawSection(section) {
    const id = section.id;
    const perWalker = {};
    const offsets = { charlie: -1, olly: 0, dad: +1 };
    const walkers = ["charlie", "olly", "dad"];
    const px = separationPX();

    walkers.forEach(w => {
        if (!section[w]) return;
        const offLatLngs = offsetByPixels(section.latlngs, offsets[w] * px);
        perWalker[w] = makeWalkerLine(offLatLngs, w, section.year);
    });

    const tmp = L.polyline(section.latlngs);
    const bounds = tmp.getBounds();
    tmp.remove();

    LINES.set(id, { byWalker: perWalker, bounds });

    // hover tooltip + click to focus
    Object.values(perWalker).forEach(layer => {
        layer.on("mouseover", (e) => {
            if (hoverPopup) map.closePopup(hoverPopup);
            const ago = section.date ? relativeTime(section.date) : "";
            hoverPopup = L.popup({ closeButton: false, className: "hover-popup", offset: [0, -5], autoPan: false })
                .setLatLng(e.latlng)
                .setContent(`<b>${section.start} \u2192 ${section.end}</b><br>${section.miles.toFixed(1)} mi${section.date ? ` \u00b7 ${ago}` : ""}<br>${walkerNames(section)}`)
                .openOn(map);
        });
        layer.on("mouseout", () => {
            if (hoverPopup) { map.closePopup(hoverPopup); hoverPopup = null; }
        });
        layer.on("click", () => {
            if (hoverPopup) { map.closePopup(hoverPopup); hoverPopup = null; }
            focusSection(id);
            highlightInSidebar(id);
        });
    });
}

function scheduleRefreshOffsets() {
    if (rafRefresh) return;
    rafRefresh = requestAnimationFrame(() => {
        rafRefresh = null;

        // Choose your corridor thickness in *meters* based on zoom…
        const corridorMeters = getWalkerWeight();      // your 600/150 logic

        // Keep separation in pixels in step with that thickness:
        const mpp = getMetersPerPixel(map);
        const pxSep = (corridorMeters * 2) / mpp;

        SECTIONS_MAP.forEach(sec => {
            const entry = LINES.get(sec.id);
            if (!entry) return;

            const offsets = { charlie: -1, olly: 0, dad: +1 };
            Object.entries(entry.byWalker).forEach(([w, layer]) => {
                layer.setLatLngs(offsetByPixels(sec.latlngs, offsets[w] * pxSep));
                layer.setCorridor(corridorMeters);     // <-- the important bit
            });
        });
    });
}

/* ====== Walker filtering (hover = map preview, click = pin everything) ====== */
function effectiveMapWalker() { return hoverWalker || selectedWalker; }

function toggleLayer(layer, show) {
    if (show && !map.hasLayer(layer)) layer.addTo(map);
    else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
}

/* Show only the effective walker's corridors + markers on the map (null = all). */
function applyMapFilter() {
    const who = effectiveMapWalker();
    LINES.forEach(entry => {
        Object.entries(entry.byWalker).forEach(([w, layer]) => {
            toggleLayer(layer, !who || w === who);
        });
    });
    MARKERS.forEach((markers, id) => {
        const sec = SECTIONS_MAP.get(id);
        const show = !who || (sec && !!sec[who]);
        markers.forEach(mk => toggleLayer(mk, show));
    });
    scheduleRefreshOffsets();
}

function updateAvatarStates() {
    const active = effectiveMapWalker();
    walkersAvatarsEl.querySelectorAll(".avatar-wrap").forEach(el => {
        const w = el.dataset.walker;
        el.classList.toggle("selected", selectedWalker === w);
        el.classList.toggle("dimmed", !!active && active !== w);
    });
}

function updateActiveFilterChip() {
    if (!selectedWalker) {
        activeFilterEl.hidden = true;
        activeFilterEl.innerHTML = "";
        return;
    }
    activeFilterEl.hidden = false;
    activeFilterEl.innerHTML =
        `<span class="af-dot ${selectedWalker}"></span>` +
        `<span>Showing ${WALKER_NAMES[selectedWalker]}'s walks</span>` +
        `<button class="af-clear" type="button" aria-label="Clear filter">✕</button>`;
    activeFilterEl.querySelector(".af-clear").addEventListener("click", () => setSelectedWalker(null));
}

/* Refresh the sidebar (list + counts + stats) for the current pinned walker.
   Avatar pies show each walker's overall total, which selection never changes,
   so we only re-toggle their selected/dimmed classes rather than rebuild them. */
function refreshSidebar() {
    renderTripsList();
    renderOverall(computeStats());
    updateAvatarStates();
    updateActiveFilterChip();
}

function setHoverWalker(who) {
    if (hoverWalker === who) return;
    hoverWalker = who;
    applyMapFilter();
    updateAvatarStates();
}

function setSelectedWalker(who) {
    // toggle off if re-selecting the same person
    selectedWalker = (who && selectedWalker === who) ? null : who;
    applyMapFilter();
    refreshSidebar();
}

/* ====== UI (year groups → trips → sections) ====== */
function sectionVisible(s) {
    const passVideo = !filterVideosEl.checked || (s.videoLink !== "" && s.videoLink !== "none");
    const passWalker = !selectedWalker || !!s[selectedWalker];
    return passVideo && passWalker;
}

function sectionDotsHTML(s) {
    const dots = [];
    if (s.charlie) dots.push('<span class="dot charlie" title="Charlie"></span>');
    if (s.olly) dots.push('<span class="dot olly" title="Olly"></span>');
    if (s.dad) dots.push('<span class="dot dad" title="Dad"></span>');
    return `<div class="dotrow">${dots.join("")}</div>`;
}

/* Build one section <li>; showTrip appends the trip name in the flat view. */
function makeSectionLi(s, showTrip = false) {
    const li = document.createElement("li");
    li.className = "section-item";
    li.dataset.id = s.id;

    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = `${s.start} → ${s.end}`;

    const meta = document.createElement("div");
    meta.className = "section-meta";
    const milesStr = `${s.miles.toFixed(1)} mi`;
    const ago = s.date ? relativeTime(s.date) : "";
    let metaText = s.date ? `${milesStr} • ${ago}` : milesStr;
    if (showTrip && s.tripName) metaText += ` • ${s.tripName}`;
    meta.textContent = metaText;

    const chips = document.createElement("div");
    chips.className = "section-chips";

    if (!s.videoLink) {
        const span = document.createElement("span");
        span.className = "badge novideo";
        span.textContent = "Unedited";
        chips.appendChild(span);
    } else if (s.videoLink === "none") {
        const span = document.createElement("span");
        span.className = "badge novideo";
        span.textContent = "No video";
        chips.appendChild(span);
    } else {
        const a = document.createElement("a");
        a.className = "badge video";
        a.href = s.videoLink; a.target = "_blank"; a.rel = "noopener";
        a.textContent = "Video ▶";
        chips.appendChild(a);
    }
    chips.insertAdjacentHTML("beforeend", sectionDotsHTML(s));

    li.style.borderLeftColor = ageColor(s.date);
    li.title = `${s.tripName}\n${walkerNames(s)}${s.date ? `\n${s.date} (${ago})` : ""}`;
    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(chips);
    li.addEventListener("click", () => focusSection(s.id));

    SECTION_ELEMENT.set(s.id, li);
    return li;
}

function renderTripsList() {
    sectionsListEl.innerHTML = "";
    SECTION_ELEMENT.clear();

    let count = 0;

    if (sortMode === "recent") {
        // Flat list across all trips, newest first
        const all = [];
        TRIPS.forEach(trip => trip.sections.forEach(s => { if (sectionVisible(s)) all.push(s); }));
        all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

        const ul = document.createElement("ul");
        ul.className = "trip-sections flat";
        all.forEach(s => { count++; ul.appendChild(makeSectionLi(s, true)); });
        sectionsListEl.appendChild(ul);
    } else {
        // Grouped by year → trip
        YEAR_GROUPS.forEach(group => {
            if (!group.trips.some(trip => trip.sections.some(sectionVisible))) return;

            const wrap = document.createElement("div");
            wrap.className = "year-group";
            const h = document.createElement("div");
            h.className = "year-heading";
            h.textContent = group.year;
            wrap.appendChild(h);

            group.trips.forEach(trip => {
                const children = trip.sections.filter(sectionVisible);
                if (!children.length) return;

                const groupDiv = document.createElement("div");
                groupDiv.className = "trip-group";

                const header = document.createElement("div");
                header.className = "trip-header";
                header.textContent = trip.name;
                groupDiv.appendChild(header);

                const ul = document.createElement("ul");
                ul.className = "trip-sections";

                children.forEach(s => { count++; ul.appendChild(makeSectionLi(s)); });

                groupDiv.appendChild(ul);
                wrap.appendChild(groupDiv);
            });

            sectionsListEl.appendChild(wrap);
        });
    }

    if (selectedWalker && count === 0) {
        const empty = document.createElement("p");
        empty.className = "silver tiny";
        empty.textContent = `No sections for ${WALKER_NAMES[selectedWalker]} match this filter.`;
        sectionsListEl.appendChild(empty);
    }

    sectionsCountEl.textContent = `${count} section${count === 1 ? "" : "s"}`;
}

/* ====== Stats + avatars with progress pies ====== */
function computeStats() {
    const perWalker = {
        charlie: { name: "Charlie", miles: 0, sections: 0, img: "images/charlie.jpg", _iv: [] },
        olly: { name: "Olly", miles: 0, sections: 0, img: "images/olly.jpg", _iv: [] },
        dad: { name: "Dad", miles: 0, sections: 0, img: "images/dad.jpg", _iv: [] },
    };
    const allIntervals = [];

    TRIPS.forEach(trip => {
        trip.sections.forEach(s => {
            allIntervals.push([s.startKm, s.endKm]);
            if (s.charlie) { perWalker.charlie.sections++; perWalker.charlie._iv.push([s.startKm, s.endKm]); }
            if (s.olly) { perWalker.olly.sections++; perWalker.olly._iv.push([s.startKm, s.endKm]); }
            if (s.dad) { perWalker.dad.sections++; perWalker.dad._iv.push([s.startKm, s.endKm]); }
        });
    });

    // Unique miles per walker (dedup overlapping path segments)
    Object.values(perWalker).forEach(w => {
        const merged = mergeIntervals(w._iv);
        w.miles = merged.reduce((sum, [s, e]) => sum + (e - s), 0) * 0.621371;
        delete w._iv;
    });

    // Unique overall miles (dedup all walkers combined)
    const overallMerged = mergeIntervals(allIntervals);
    const overallMiles = overallMerged.reduce((sum, [s, e]) => sum + (e - s), 0) * 0.621371;
    const overallSections = allIntervals.length;

    return { perWalker, overallMiles, overallSections };
}

function renderAvatars(stats) {
    walkersAvatarsEl.innerHTML = "";
    Object.entries(stats.perWalker).forEach(([key, w]) => {
        const pct = Math.min(100, (w.miles / ROUTE_MILES) * 100);
        const wrap = document.createElement("div");
        wrap.className = "avatar-wrap";
        wrap.dataset.walker = key;
        wrap.setAttribute("role", "button");
        wrap.setAttribute("tabindex", "0");
        wrap.title = `Show only ${w.name}'s sections (click to pin)`;
        wrap.innerHTML = `
      <div class="avatar-pie" style="--pct:${pct}; --color:${rgba(key, 1)};">
        <img src="${w.img}" alt="${w.name}">
      </div>
      <div class="avatar-label">${w.name} · ${pct.toFixed(0)}%</div>
    `;
        wrap.addEventListener("mouseenter", () => setHoverWalker(key));
        wrap.addEventListener("mouseleave", () => setHoverWalker(null));
        wrap.addEventListener("click", () => setSelectedWalker(key));
        wrap.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedWalker(key); }
        });
        walkersAvatarsEl.appendChild(wrap);
    });
}

function renderOverall(stats) {
    const w = selectedWalker ? stats.perWalker[selectedWalker] : null;
    const doneMiles = w ? w.miles : stats.overallMiles;
    const doneSections = w ? w.sections : stats.overallSections;
    const doneLabel = w ? `${w.name}'s miles` : "Done miles";
    const secLabel = w ? `${w.name}'s sections` : "Done sections";
    overallStatsEl.innerHTML = `
  <div class="kpi"><div class="label">Total miles</div><div class="value">${ROUTE_MILES.toFixed(1)} mi</div></div>
    <div class="kpi"><div class="label">${doneLabel}</div><div class="value">${doneMiles.toFixed(1)} mi</div></div>
    <div class="kpi"><div class="label">${secLabel}</div><div class="value">${doneSections}</div></div>
  `;
}

/* ====== Focus/selection ====== */
let currentId = null;

/* fitBounds that keeps content clear of the mobile bottom sheet when it's open. */
function fitBoundsAware(bounds, padFactor = 0.2) {
    const isMobile = window.matchMedia("(max-width: 860px)").matches;
    const sheetOpen = isMobile && !sidebar.classList.contains("closed");
    if (sheetOpen) {
        map.fitBounds(bounds.pad(padFactor), { paddingBottomLeft: [0, sidebar.offsetHeight] });
    } else {
        map.fitBounds(bounds.pad(padFactor));
    }
}

function focusSection(id) {
    currentId = id;
    const entry = LINES.get(id);
    if (!entry) return;
    const isMobile = window.matchMedia("(max-width: 860px)").matches;
    if (isMobile) {
        sidebar.classList.remove("closed");
        setTimeout(() => map.invalidateSize(), 260);
    }
    fitBoundsAware(entry.bounds, 0.25);
    scheduleRefreshOffsets();
    highlightInSidebar(id);
}

function highlightInSidebar(id) {
    SECTION_ELEMENT.forEach(el => el.classList.remove("active"));
    const el = SECTION_ELEMENT.get(id);
    if (el) {
        el.classList.add("active");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

/* ====== Mobile toggle ====== */
openBtn.addEventListener("click", () => {
    sidebar.classList.toggle("closed");
    setTimeout(() => map.invalidateSize(), 260);
});

/* ====== MAIN ====== */
(async function init() {
    await loadRouteFromContinuousGPX();

    buildFromTrips();
    computeNewestYear();

    // Draw all sections
    TRIPS.forEach(trip => trip.sections.forEach(drawSection));

    // Start/end markers (smaller) for each section start and any flagged end
    TRIPS.forEach(trip => {
        trip.sections.forEach(d => {
            const icon = L.icon({
                iconUrl: MARKER_ICON_URL, shadowUrl: MARKER_SHADOW_URL,
                iconSize: [20, 32], iconAnchor: [10, 32], popupAnchor: [1, -28], shadowSize: [32, 32],
            });
            const marks = [];
            const s = L.marker(d.startCoords, { title: d.start, icon }).addTo(map);
            s.bindPopup(d.start);
            marks.push(s);
            if (d.fixEnd) {
                const e = L.marker(d.endCoords, { title: d.end, icon }).addTo(map);
                e.bindPopup(d.end);
                marks.push(e);
            }
            MARKERS.set(d.id, marks);
        });
    });

    // Sidebar UI
    renderTripsList();
    const stats = computeStats();
    renderAvatars(stats);      // images + progress pies
    renderOverall(stats);
    updateAvatarStates();
    filterVideosEl.addEventListener("change", renderTripsList);
    sortModeEl.addEventListener("change", () => { sortMode = sortModeEl.value; renderTripsList(); });

    // Fit map to all drawn bounds (account for the bottom sheet on mobile)
    if (LINES.size) {
        const groupBounds = Array.from(LINES.values())
            .reduce((acc, { bounds }) => acc
                ? acc.extend(bounds)
                : bounds.pad(0) // ← returns a NEW LatLngBounds
                , null);

        if (groupBounds && groupBounds.isValid()) fitBoundsAware(groupBounds, 0.2);
    }

    // keep three lines separated at any zoom/pan (pixel-space offsets)
    map.on("zoomend", scheduleRefreshOffsets);
    map.on("moveend", scheduleRefreshOffsets);
    scheduleRefreshOffsets();
})();
