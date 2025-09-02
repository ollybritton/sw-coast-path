/* ====== CONFIG ====== */
const ROUTE_URL = "route.gpx";         // stitched continuous GPX
const PRE_DECIMATE_METERS = 5;         // quick dedupe before simplification
const SNAP_TOL_METERS = 20;            // smaller = curvier
const WALKER_WEIGHT = 6;               // coloured line weight

/* ====== DOM ====== */
const mapEl = document.getElementById("map");
const sidebar = document.getElementById("sidebar");
const openBtn = document.getElementById("open-sidebar");

const sectionsListEl = document.getElementById("sections-list");
const sectionsCountEl = document.getElementById("sections-count");
const filterVideosEl = document.getElementById("filter-videos");
const overallStatsEl = document.getElementById("overall-stats");
const walkersAvatarsEl = document.getElementById("walkers-avatars");

/* ====== MAP ====== */
const canvasRenderer = L.canvas({ padding: 0.5 });
const map = L.map(mapEl, { attributionControl: false, preferCanvas: true }).setView([50.7, -3.5], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);
L.control.attribution({ position: "topright" }).addTo(map);

/* ====== HELPERS ====== */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const makeId = s => `${slug(s.start)}_to_${slug(s.end)}_${s.date || "nodate"}`;
const toLngLat = ([lat, lng]) => [lng, lat];
const toLatLng = ([lng, lat]) => [lat, lng];
const coordsToLatLngs = coords => coords.map(toLatLng);
const metersToDegrees = m => m / 111320;

// RGB for rgba()
const RGB = {
  charlie: [220, 38, 38],   // red-600
  olly:    [37, 99, 235],   // blue-600
  dad:     [22, 163, 74],   // green-600
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
  return { latlngs, km };
}

/* ====== DATA FROM NEW trips-based HIKE_DATA ====== */
let TRIPS = [];                 // [{ name, year, sections:[...] }]
let YEAR_GROUPS = [];           // [{ year, trips:[...] }]
let SECTIONS_MAP = new Map();   // id -> section object
let LINES = new Map();          // id -> { byWalker, bounds }
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

      const { latlngs, km } = sliceOnRoute(item.startCoords, item.endCoords);
      const miles = km * 0.621371;
      const id = makeId(item);
      const year = item.date ? new Date(item.date).getFullYear() : null;
      const sec = {
        id, year,
        tripName: trip.name,
        start: item.start, end: item.end,
        startCoords: item.startCoords, endCoords: item.endCoords,
        direction: item.direction,
        latlngs, km, miles,
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
    .sort((a, b) => (b[0] + "").localeCompare(a[0] + ""))  // desc
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

function makeWalkerLine(latlngs, who, year) {
  return L.polyline(latlngs, {
    color: rgba(who, yearOpacity(year)), // paler for older years
    weight: WALKER_WEIGHT, opacity: 1,
    lineCap: "round", renderer: canvasRenderer, smoothFactor: 1.2,
  }).addTo(map);
}

/* separation in pixels – tuned so it stays apart even when zoomed way out */
function separationPX() {
  const z = map.getZoom();
  return z >= 12 ? 8 : z >= 10 ? 7 : z >= 8 ? 6 : 5;
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

  // clicking any coloured line focuses + highlights in sidebar
  Object.values(perWalker).forEach(layer => {
    layer.on("click", () => {
      focusSection(id);
      highlightInSidebar(id);
    });
  });
}

let rafRefresh = null;
function scheduleRefreshOffsets() {
  if (rafRefresh) return;
  rafRefresh = requestAnimationFrame(() => {
    rafRefresh = null;
    const px = separationPX();
    SECTIONS_MAP.forEach(sec => {
      const entry = LINES.get(sec.id);
      if (!entry) return;
      const offsets = { charlie: -1, olly: 0, dad: +1 };
      Object.entries(entry.byWalker).forEach(([w, layer]) => {
        const latlngs = offsetByPixels(sec.latlngs, offsets[w] * px);
        layer.setLatLngs(latlngs);
      });
    });
  });
}

/* ====== UI (year groups → trips → sections) ====== */
function sectionDotsHTML(s){
  const dots = [];
  if (s.charlie) dots.push('<span class="dot charlie" title="Charlie"></span>');
  if (s.olly)    dots.push('<span class="dot olly" title="Olly"></span>');
  if (s.dad)     dots.push('<span class="dot dad" title="Dad"></span>');
  return `<div class="dotrow">${dots.join("")}</div>`;
}

function renderTripsList() {
  const videoOnly = filterVideosEl.checked;
  sectionsListEl.innerHTML = "";
  SECTION_ELEMENT.clear();

  let count = 0;

  YEAR_GROUPS.reverse().forEach(group => {
    // year heading
    const wrap = document.createElement("div");
    wrap.className = "year-group";
    const h = document.createElement("div");
    h.className = "year-heading";
    h.textContent = group.year;
    wrap.appendChild(h);

    group.trips.forEach(trip => {
      const children = trip.sections.filter(s => !videoOnly || !!s.videoLink);
      if (!children.length) return;

      const groupDiv = document.createElement("div");
      groupDiv.className = "trip-group";

      const header = document.createElement("div");
      header.className = "trip-header";
      header.textContent = trip.name;
      groupDiv.appendChild(header);

      const ul = document.createElement("ul");
      ul.className = "trip-sections";

      children.forEach(s => {
        count++;

        const li = document.createElement("li");
        li.className = "section-item";
        li.dataset.id = s.id;

        const title = document.createElement("div");
        title.className = "section-title";
        title.textContent = `${s.start} → ${s.end}`;

        const meta = document.createElement("div");
        meta.className = "section-meta";
        const milesStr = `${s.miles.toFixed(1)} mi`;
        meta.textContent = s.date ? `${milesStr} • ${s.date}` : milesStr;

        const chips = document.createElement("div");
        chips.className = "section-chips";

        if (s.videoLink) {
          const a = document.createElement("a");
          a.className = "badge video";
          a.href = s.videoLink; a.target = "_blank"; a.rel = "noopener";
          a.textContent = "Video ▶";
          chips.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.className = "badge novideo";
          span.textContent = "No video";
          chips.appendChild(span);
        }
        chips.insertAdjacentHTML("beforeend", sectionDotsHTML(s));

        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(chips);
        li.addEventListener("click", () => focusSection(s.id));

        SECTION_ELEMENT.set(s.id, li);
        ul.appendChild(li);
      });

      groupDiv.appendChild(ul);
      wrap.appendChild(groupDiv);
    });

    sectionsListEl.appendChild(wrap);
  });

  sectionsCountEl.textContent = `${count} section${count === 1 ? "" : "s"}`;
}

/* ====== Stats + avatars with progress pies ====== */
function computeStats() {
  const perWalker = {
    charlie: { name: "Charlie", miles: 0, sections: 0, img: "images/charlie.jpg" },
    olly:    { name: "Olly",    miles: 0, sections: 0, img: "images/olly.jpg" },
    dad:     { name: "Dad",     miles: 0, sections: 0, img: "images/dad.jpg" },
  };
  let overallMiles = 0;
  let overallSections = 0;

  TRIPS.forEach(trip => {
    trip.sections.forEach(s => {
      overallMiles += s.miles; overallSections++;
      if (s.charlie) { perWalker.charlie.miles += s.miles; perWalker.charlie.sections++; }
      if (s.olly)    { perWalker.olly.miles    += s.miles; perWalker.olly.sections++; }
      if (s.dad)     { perWalker.dad.miles     += s.miles; perWalker.dad.sections++; }
    });
  });

  return { perWalker, overallMiles, overallSections };
}

function renderAvatars(stats) {
  walkersAvatarsEl.innerHTML = "";
  Object.entries(stats.perWalker).forEach(([key, w]) => {
    const pct = Math.min(100, (w.miles / ROUTE_MILES) * 100);
    const wrap = document.createElement("div");
    wrap.className = "avatar-wrap";
    wrap.innerHTML = `
      <div class="avatar-pie" style="--pct:${pct}; --color:${rgba(key, 1)};">
        <img src="${w.img}" alt="${w.name}">
      </div>
      <div class="avatar-label">${w.name} · ${pct.toFixed(0)}%</div>
    `;
    walkersAvatarsEl.appendChild(wrap);
  });
}

function renderOverall(stats) {
  overallStatsEl.innerHTML = `
  <div class="kpi"><div class="label">Total miles</div><div class="value">${ROUTE_MILES.toFixed(1)} mi</div></div>
    <div class="kpi"><div class="label">Done miles</div><div class="value">${stats.overallMiles.toFixed(1)} mi</div></div>
    <div class="kpi"><div class="label">Done sections</div><div class="value">${stats.overallSections}</div></div>
  `;
}

/* ====== Focus/selection ====== */
let currentId = null;
function focusSection(id) {
  currentId = id;
  const entry = LINES.get(id);
  if (!entry) return;
  map.fitBounds(entry.bounds.pad(0.25));
  // emphasize selected by weight bump
  LINES.forEach((v, key) => {
    const selected = key === id;
    Object.values(v.byWalker).forEach(layer => {
      layer.setStyle({ weight: selected ? (WALKER_WEIGHT + 2) : WALKER_WEIGHT });
    });
  });
  // keep the sheet visible on mobile
  if (window.matchMedia("(max-width: 860px)").matches) {
    sidebar.classList.remove("closed");
    setTimeout(() => map.invalidateSize(), 200);
  }
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
      const s = L.marker(d.startCoords, { title: d.start, icon }).addTo(map);
      s.bindPopup(d.start);
      if (d.fixEnd) {
        const e = L.marker(d.endCoords, { title: d.end, icon }).addTo(map);
        e.bindPopup(d.end);
      }
    });
  });

  // Sidebar UI
  renderTripsList();
  const stats = computeStats();
  renderAvatars(stats);      // images + progress pies
  renderOverall(stats);
  filterVideosEl.addEventListener("change", renderTripsList);

  // Fit map to all drawn bounds
  if (LINES.size) {
    const groupBounds = Array.from(LINES.values())
      .reduce((acc, { bounds }) => acc ? acc.extend(bounds) : bounds, null);
    if (groupBounds) map.fitBounds(groupBounds.pad(0.2));
  }

  // keep three lines separated at any zoom/pan (pixel-space offsets)
  map.on("zoom", scheduleRefreshOffsets);
  map.on("zoomend", scheduleRefreshOffsets);
  map.on("moveend", scheduleRefreshOffsets);
  scheduleRefreshOffsets();
})();
