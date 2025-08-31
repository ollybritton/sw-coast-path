/* ====== CONFIG ====== */
const ROUTE_URL = "route.gpx";   // the stitched, continuous GPX
const PRE_DECIMATE_METERS = 5;              // quick dedupe before simplification
const SNAP_TOL_METERS = 20;                 // smaller = curvier, a bit more CPU
const OFFSET_METERS = 14;                   // lateral offset for triple-line look
const BASE_WEIGHT = 11;                     // grey underlay
const WALKER_WEIGHT = 8;                    // coloured overlays

/* ====== DOM ====== */
const mapEl = document.getElementById("map");
const sidebar = document.getElementById("sidebar");
const openBtn = document.getElementById("open-sidebar");

const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = {
  sections: document.getElementById("tab-sections"),
  walkers: document.getElementById("tab-walkers"),
  stats: document.getElementById("tab-stats"),
};
const sectionsListEl = document.getElementById("sections-list");
const sectionsCountEl = document.getElementById("sections-count");
const filterVideosEl = document.getElementById("filter-videos");
const walkersCardsEl = document.getElementById("walkers-cards");
const overallStatsEl = document.getElementById("overall-stats");

/* ====== MAP ====== */
const canvasRenderer = L.canvas({ padding: 0.5 });
const map = L.map(mapEl, { attributionControl: false, preferCanvas: true }).setView([50.7, -3.5], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);
L.control.attribution({ position: "topright" }).addTo(map);

const sectionLayers = new Map(); // id -> { base, overlays[], bounds }

/* ====== HELPERS ====== */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const makeId = s => `${slug(s.start)}_to_${slug(s.end)}`;

const toLngLat = ([lat, lng]) => [lng, lat];
const toLatLng = ([lng, lat]) => [lat, lng];
const coordsToLatLngs = coords => coords.map(toLatLng);
const metersToDegrees = m => m / 111320;

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

/* Lateral offset (≈meters) for the triple-line look */
function offsetLatLngs(latlngs, meters) {
  if (Math.abs(meters) < 1e-6) return latlngs.slice();
  const out = [];
  for (let i = 0; i < latlngs.length; i++) {
    const [lat, lng] = latlngs[i];
    const [plat, plng] = latlngs[i - 1] || latlngs[i];
    const [nlat, nlng] = latlngs[i + 1] || latlngs[i];
    const lonPerDeg = 111320 * Math.cos(lat * Math.PI / 180);
    const vx = (nlng - plng) * lonPerDeg;
    const vy = (nlat - plat) * 111320;
    const nx = -vy, ny = vx;
    const norm = Math.hypot(nx, ny) || 1;
    const ux = (nx / norm) * meters;
    const uy = (ny / norm) * meters;
    const dLng = ux / lonPerDeg;
    const dLat = uy / 111320;
    out.push([lat + dLat, lng + dLng]);
  }
  return out;
}

/* ====== ROUTE (continuous GPX) ====== */
let ROUTE = null;         // Feature<LineString> simplified for snapping/slicing
let ROUTE_MILES = 630;    // recomputed from ROUTE length
let SECTIONS = [];        // built from walked items only

async function loadRouteFromContinuousGPX() {
  const res = await fetch(ROUTE_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error("route_continuous.gpx not found");
  const xml = new DOMParser().parseFromString(await res.text(), "application/xml");

  // Collect *all* trkpt in document order (your stitched file should have a single trkseg)
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
  // If empty or too short, try the other way
  if (!seg || !seg.geometry || seg.geometry.coordinates.length < 2) {
    seg = turf.lineSlice(b, a, ROUTE);
  }

  const km = turf.length(seg, { units: "kilometers" });
  const latlngs = coordsToLatLngs(seg.geometry.coordinates);
  return { latlngs, km };
}

/* ====== BUILD ONLY WALKED SECTIONS ====== */
function buildSections() {
  const walked = HIKE_DATA.filter(d => d.charlie || d.olly || d.dad);
  SECTIONS = walked.map((d, idx) => {
    const id = makeId(d);
    const { latlngs, km } = sliceOnRoute(d.startCoords, d.endCoords);
    const miles = km * 0.621371;

    return {
      id,
      order: idx,
      title: `${d.start} → ${d.end}`,
      start: d.start, end: d.end,
      startCoords: d.startCoords, endCoords: d.endCoords,
      latlngs, km, miles,
      videoLink: d.videoLink || "",
      charlie: !!d.charlie,
      olly: !!d.olly,
      dad: !!d.dad,
    };
  });
}

/* ====== RENDER SECTIONS ====== */
function renderSection(section) {
  const id = section.id;

  // Grey underlay
  const base = L.polyline(section.latlngs, {
    color: "#333",
    weight: BASE_WEIGHT,
    opacity: 1,
    lineCap: "round",
    renderer: canvasRenderer,
    smoothFactor: 1.2,
  }).addTo(map);

  // Triple solid lines, offset and thick
  const overlays = [];
  const walkers = [
    ["charlie", COLORS.charlie, -OFFSET_METERS],
    ["olly",    COLORS.olly,          0],
    ["dad",     COLORS.dad,     +OFFSET_METERS],
  ];
  walkers.forEach(([key, color, offset]) => {
    if (!section[key]) return;
    const offLatLngs = offsetLatLngs(section.latlngs, offset);
    const line = L.polyline(offLatLngs, {
      color,
      weight: WALKER_WEIGHT,
      opacity: 1,
      lineCap: "round",
      renderer: canvasRenderer,
      smoothFactor: 1.2,
    }).addTo(map);
    overlays.push(line);
  });

  const bounds = base.getBounds();
  sectionLayers.set(id, { base, overlays, bounds });

  const onClick = () => focusSection(id);
  base.on("click", onClick);
  overlays.forEach(o => o.on("click", onClick));
}

/* ====== UI: Sections list ====== */
function renderSectionsList() {
  const onlyVideos = filterVideosEl.checked;
  sectionsListEl.innerHTML = "";

  const filtered = SECTIONS.filter(s => !onlyVideos || !!s.videoLink);
  sectionsCountEl.textContent = `${filtered.length} section${filtered.length === 1 ? "" : "s"}`;

  filtered.forEach(s => {
    const li = document.createElement("li");
    li.className = "section-item";
    li.dataset.id = s.id;

    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = s.title;

    const meta = document.createElement("div");
    meta.className = "section-meta";
    const milesStr = `${s.miles.toFixed(1)} mi`;
    meta.textContent = milesStr;

    const chips = document.createElement("div");
    chips.className = "section-chips";
    if (s.charlie) chips.innerHTML += `<span class="dot charlie" title="Charlie"></span>`;
    if (s.olly)    chips.innerHTML += `<span class="dot olly" title="Olly"></span>`;
    if (s.dad)     chips.innerHTML += `<span class="dot dad" title="Dad"></span>`;
    if (s.videoLink) {
      const a = document.createElement("a");
      a.className = "badge video";
      a.href = s.videoLink;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Video ▶";
      chips.appendChild(a);
    }

    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(chips);
    li.addEventListener("click", () => focusSection(s.id));
    sectionsListEl.appendChild(li);
  });
}

/* ====== UI: Walkers + Stats ====== */
function computeStats() {
  const perWalker = {
    charlie: { name: "Charlie", miles: 0, sections: 0, color: COLORS.charlie },
    olly:    { name: "Olly",    miles: 0, sections: 0, color: COLORS.olly },
    dad:     { name: "Dad",     miles: 0, sections: 0, color: COLORS.dad },
  };
  let overallMiles = 0;
  let overallSections = 0;

  SECTIONS.forEach(s => {
    const m = s.miles;
    overallMiles += m;
    overallSections++;
    if (s.charlie) { perWalker.charlie.miles += m; perWalker.charlie.sections++; }
    if (s.olly)    { perWalker.olly.miles    += m; perWalker.olly.sections++; }
    if (s.dad)     { perWalker.dad.miles     += m; perWalker.dad.sections++; }
  });
  return { perWalker, overallMiles, overallSections };
}

function renderWalkers(stats) {
  walkersCardsEl.innerHTML = "";
  Object.values(stats.perWalker).forEach(w => {
    const pct = Math.min(100, Math.round((w.miles / ROUTE_MILES) * 100));
    const card = document.createElement("div");
    card.className = "walker-card";
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <span class="dot" style="background:${w.color}; margin-right:8px;"></span>
          <strong>${w.name}</strong>
        </div>
        <span class="value">${w.miles.toFixed(1)} mi</span>
      </div>
      <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
      <div class="mt1 silver f6">${pct}% of ~${ROUTE_MILES} miles • ${w.sections} section${w.sections===1?"":"s"}</div>
    `;
    walkersCardsEl.appendChild(card);
  });
}

function renderOverall(stats) {
  overallStatsEl.innerHTML = `
    <div class="kpi"><div class="label">Total miles</div><div class="value">${stats.overallMiles.toFixed(1)} mi</div></div>
    <div class="kpi"><div class="label">Sections</div><div class="value">${stats.overallSections}</div></div>
    <div class="kpi"><div class="label">Route length</div><div class="value">~${ROUTE_MILES} mi</div></div>
  `;
}

/* ====== Focus/selection ====== */
let currentId = null;
function focusSection(id) {
  currentId = id;
  const layer = sectionLayers.get(id);
  if (!layer) return;
  map.fitBounds(layer.bounds.pad(0.25));
  if (window.matchMedia("(max-width: 860px)").matches) {
    sidebar.classList.add("open");
    setTimeout(() => map.invalidateSize(), 250);
  }
  sectionLayers.forEach(({ base, overlays }, key) => {
    const selected = key === id;
    base.setStyle({ weight: selected ? BASE_WEIGHT + 2 : BASE_WEIGHT });
    overlays.forEach(o => o.setStyle({ weight: selected ? WALKER_WEIGHT + 2 : WALKER_WEIGHT }));
  });
}

/* ====== Tabs + mobile toggles ====== */
tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    tabs.forEach(b => b.classList.toggle("active", b === btn));
    const name = btn.dataset.tab;
    Object.entries(panels).forEach(([k, el]) => el.classList.toggle("active", k === name));
  });
});
openBtn.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  setTimeout(() => map.invalidateSize(), 260);
});
map.on("click", () => {
  if (sidebar.classList.contains("open")) {
    sidebar.classList.remove("open");
    setTimeout(() => map.invalidateSize(), 260);
  }
});

/* ====== MAIN ====== */
(async function init() {
  await loadRouteFromContinuousGPX();

  // Build & draw ONLY walked sections
  const walked = HIKE_DATA.filter(d => d.charlie || d.olly || d.dad);

  // Optional markers only for walked sections’ starts (and flagged ends)
  walked.forEach(d => {
    const startMarker = L.marker(d.startCoords, {
      title: d.start,
      icon: L.icon({
        iconUrl: MARKER_ICON_URL, shadowUrl: MARKER_SHADOW_URL,
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
      })
    }).addTo(map);
    startMarker.bindPopup(d.start);
    if (d.fixEnd) {
      const endMarker = L.marker(d.endCoords, {
        title: d.end,
        icon: L.icon({
          iconUrl: MARKER_ICON_URL, shadowUrl: MARKER_SHADOW_URL,
          iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
        })
      }).addTo(map);
      endMarker.bindPopup(d.end);
    }
  });

  buildSections();
  SECTIONS.forEach(s => renderSection(s));

  // UI
  renderSectionsList();
  const stats = computeStats();
  renderWalkers(stats);
  renderOverall(stats);
  filterVideosEl.addEventListener("change", renderSectionsList);

  // Fit to walked geometry
  if (sectionLayers.size) {
    const groupBounds = Array.from(sectionLayers.values())
      .reduce((acc, { bounds }) => acc ? acc.extend(bounds) : bounds, null);
    if (groupBounds) map.fitBounds(groupBounds.pad(0.2));
  }
})();
