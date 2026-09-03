/* ====== MAP: Leaflet setup, route loading, drawing walked sections, markers ====== */

let rafRefresh = null;
let hoverPopup = null;

const canvasRenderer = L.canvas({ padding: 0.5 });
const map = L.map(mapEl, { attributionControl: false, preferCanvas: true, zoomControl: false }).setView([50.7, -3.5], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);
// Labels pane: sits above the route/walked corridors (overlayPane, z 400) so place
// names stay readable, but below the marker pane (600), tooltip pane (650, e.g. the
// permanent "Minehead" / "South Haven Point" end labels) and popup pane (700) so
// those never get painted over by label tiles.
map.createPane("labels");
map.getPane("labels").style.zIndex = 450;
map.getPane("labels").style.pointerEvents = "none";
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    pane: "labels",
    maxZoom: 19,
}).addTo(map);

// Route pane: sits below the walked corridors (default overlayPane, z 400) so the
// "not yet walked" line never obscures the coloured bands, at any zoom.
map.createPane("route");
map.getPane("route").style.zIndex = 350;
map.getPane("route").style.pointerEvents = "none";

// Overview pane: the low-zoom coverage bands (see OVERVIEW LAYERS below). Sits
// above the route line (350) but below the corridors/markers' overlayPane
// (400, the Leaflet default), so the bands never cover the end-point dots —
// pane z-index settles this regardless of the order layers happen to be
// added to the map in.
map.createPane("overview");
map.getPane("overview").style.zIndex = 380;
map.getPane("overview").style.pointerEvents = "none";

// Two canvases sharing the "overview" pane: overviewRenderer draws first
// ("some of us" + the per-walker layers), overviewTopRenderer second ("all
// three") — later-appended canvas elements paint on top of earlier ones, so
// this guarantees "all three" always shows through over "some of us"
// wherever the two coincide, however the layers happen to be added/removed.
const overviewRenderer = L.canvas({ pane: "overview", padding: 0.5 });
const overviewTopRenderer = L.canvas({ pane: "overview", padding: 0.5 });

L.control.attribution({ position: "topright" }).addTo(map);
L.control.zoom({ position: "topright" }).addTo(map);

/* Read a design token for use as a Leaflet layer colour (canvas layers need real
   colour strings, not CSS custom properties). */
function mapToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ====== "Whole path" control: fit the map to everything drawn, only useful when zoomed in ====== */
const WHOLE_PATH_MIN_ZOOM = 9; // shown once zoom exceeds this

const WholePathControl = L.Control.extend({
    options: { position: "topright" },
    onAdd: function () {
        const container = L.DomUtil.create("div", "leaflet-bar whole-path-control");
        const btn = L.DomUtil.create("button", "whole-path-btn", container);
        btn.type = "button";
        btn.textContent = "Whole path";
        btn.setAttribute("aria-label", "Zoom out to show the whole path");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, "click", (e) => {
            L.DomEvent.stop(e);
            fitAll(); // defined in js/mobile.js
        });
        return container;
    }
});
const wholePathControl = new WholePathControl().addTo(map);

function updateWholePathVisibility() {
    const show = map.getZoom() > WHOLE_PATH_MIN_ZOOM;
    wholePathControl.getContainer().classList.toggle("visible", show);
}

/* ====== Legend: mode-aware ======
   Overview mode (see OVERVIEW_MAX_ZOOM below): three coverage tones, or just
   the pinned/hovered walker's colour. Detail mode: the three walker colours.
   Rebuilt on zoomend and on every walker-filter change — see
   updateRenderModeVisibility, which calls updateLegendContent(). */
function legendRowHTML(swatchClass, label) {
    return `<div class="legend-row"><span class="legend-swatch ${swatchClass}"></span>${label}</div>`;
}

// The initial paint is always overview mode with nobody pinned (fitAll() lands
// at zoom 8/7, and selectedWalker starts null), so this doubles as both the
// control's first-paint content and the reusable "nobody pinned" rows.
const LEGEND_ROWS_OVERVIEW_ALL =
    legendRowHTML("all", "All three") +
    legendRowHTML("some", "Some of us") +
    legendRowHTML("unwalked", "Not yet walked");

function legendRowsHTML() {
    const who = effectiveMapWalker();
    if (isOverviewZoom()) {
        return who
            ? legendRowHTML(who, WALKER_NAMES[who]) + legendRowHTML("unwalked", "Not yet walked")
            : LEGEND_ROWS_OVERVIEW_ALL;
    }
    return legendRowHTML("charlie", "Charlie") +
        legendRowHTML("olly", "Olly") +
        legendRowHTML("dad", "Dad") +
        legendRowHTML("unwalked", "Not yet walked");
}

let legendEl = null;

function updateLegendContent() {
    if (legendEl) legendEl.innerHTML = legendRowsHTML();
}

const LegendControl = L.Control.extend({
    onAdd: function () {
        const div = L.DomUtil.create("div", "map-legend");
        legendEl = div;
        div.innerHTML = LEGEND_ROWS_OVERVIEW_ALL;
        L.DomEvent.disableClickPropagation(div);
        return div;
    }
});
// On narrow screens the bottom is covered by the sheet, so the legend joins the
// top-right stack (under attribution / zoom / whole-path) instead of bottom-left.
const legendPosition = window.matchMedia("(max-width: 860px)").matches ? "topright" : "bottomleft";
new LegendControl({ position: legendPosition }).addTo(map);

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
let ROUTE_LOW = null;     // further-simplified copy, used to draw the unwalked line at low zoom
let ROUTE_MILES = 630;    // recomputed from ROUTE length

const DETAIL_ZOOM = 11;   // at/above this zoom: per-metre corridors + walk-boundary dots
                           // below this zoom: bold minimum-width bands + path-end dots only

/* At/below this zoom the per-section three-strand rendering (LINES) is
   replaced by "overview mode": merged coverage bands built from route-km
   intervals, exactly like the sidebar's coverage bar (js/header.js:
   renderRouteBar). At the default zoom (8, or 7 on phones) three 5px offset
   strands per section merge into an illegible blob — coverage bands read
   clearly at any zoom because they're one continuous band per coverage level,
   not one strand per walk section. Zoom 10 (DETAIL_ZOOM - 1) stays in strand
   mode but tuned to avoid the strands folding over themselves on bends — see
   MIN_BAND_PX and displayLatLngsForZoom. */
const OVERVIEW_MAX_ZOOM = 9;
function isOverviewZoom() {
    return map.getZoom() <= OVERVIEW_MAX_ZOOM;
}

const routeRenderer = L.canvas({ pane: "route", padding: 0.5 });
let routeLine = null;

function routeLatLngsForZoom() {
    const feature = (map.getZoom() < DETAIL_ZOOM && ROUTE_LOW) ? ROUTE_LOW : ROUTE;
    return coordsToLatLngs(feature.geometry.coordinates);
}

/* Draw (or redraw) the whole path as a soft "not yet walked" line, underneath
   the walked corridors at every zoom. */
function drawRouteLine() {
    if (!ROUTE) return;
    const latlngs = routeLatLngsForZoom();
    if (routeLine) {
        routeLine.setLatLngs(latlngs);
        return;
    }
    routeLine = L.polyline(latlngs, {
        color: mapToken("--route-unwalked"),
        weight: 3,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        renderer: routeRenderer,
        interactive: false,
    }).addTo(map);
}

function updateRouteDetail() {
    if (routeLine) routeLine.setLatLngs(routeLatLngsForZoom());
}

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

    // Coarser copy for low-zoom overview rendering, so the unwalked line stays cheap to draw.
    ROUTE_LOW = turf.simplify(ROUTE, { tolerance: metersToDegrees(200), highQuality: false, mutate: false });

    drawRouteLine();
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

/* ====== DRAW LINES ====== */
const MIN_BAND_PX = 4; // at zoom 10 (the lowest zoom the strand rendering still runs at), walker
                        // bands must read as at least this many screen pixels wide. Thin enough
                        // that, paired with the 2px gap (LOW_ZOOM_GAP_PX below), offset strands
                        // stay legibly separate on bends instead of folding over themselves —
                        // see displayLatLngsForZoom for the matching simplification change.

function getWalkerWeight() {
    const z = map.getZoom();
    let meters;
    if (z <= 9) meters = 500;
    else if (z <= 12) meters = 150;
    else meters = 150 * Math.pow(0.4, z - 12); // shrink the corridor so lines thin out on screen

    if (z <= 10) {
        // Below zoom 11 the metre-based corridor can shrink to a hairline on screen
        // (large metres-per-pixel). Floor it so bands stay legible as "walked" bands.
        const mpp = getMetersPerPixel(map);
        const minMeters = (MIN_BAND_PX * mpp) / 2; // inverse of L.Corridor's weight = corridor*2/mpp
        if (meters < minMeters) meters = minMeters;
    }
    return meters;
}

function makeWalkerLine(latlngs, who) {
    return L.corridor(latlngs, {
        color: rgba(who, 1),
        corridor: getWalkerWeight(),
        opacity: 1,
        lineCap: "round",
        renderer: canvasRenderer,
        smoothFactor: 1,
    }).addTo(map);
}

/* separation in pixels – tuned so it stays apart even when zoomed way out.
   The base amount is exactly one band's own drawn width, so bands sit edge to
   edge with no gap; below DETAIL_ZOOM (11) that reads as one solid block, so a
   couple of extra pixels are added there to make each strand legible on its own.
   Zoom 11+ is untouched. Used by both the initial draw (drawSection) and the
   zoom/pan refresh (scheduleRefreshOffsets) so the two always agree. */
const LOW_ZOOM_GAP_PX = 2;
function separationPX() {
    const bandPx = getWalkerWeight() * 2 / getMetersPerPixel(map);
    return map.getZoom() < DETAIL_ZOOM ? bandPx + LOW_ZOOM_GAP_PX : bandPx;
}

/* Coarsen a section's line to match current zoom: full GPX detail up close,
   simplified (like the old route-sliced lines) when zoomed out, so dense
   personal tracks don't look noisy/jittery at low zoom. */
function displayLatLngsForZoom(sec) {
    const latlngs = sec.latlngs;
    if (!latlngs || latlngs.length < 3) return latlngs;

    const mpp = getMetersPerPixel(map);
    // Below DETAIL_ZOOM the offset strands are wide relative to the route's own
    // bends, so the 80m cap used at zoom 11+ doesn't simplify hard enough: small
    // zigzags in the GPX get amplified by offsetByPixels() into strands that
    // visibly fold back on themselves at bends. Drop the cap there instead.
    const tolM = map.getZoom() < DETAIL_ZOOM ? mpp * 2 : Math.min(80, Math.max(3, mpp * 3));
    if (tolM <= 3) return latlngs; // already at (or finer than) stored precision

    const line = turf.lineString(latlngs.map(([lat, lon]) => [lon, lat]));
    const simplified = turf.simplify(line, { tolerance: metersToDegrees(tolM), highQuality: false, mutate: false });
    const out = coordsToLatLngs(simplified.geometry.coordinates);
    return out.length >= 2 ? out : latlngs;
}

const WALKER_OFFSETS = { charlie: -1, olly: 0, dad: +1 };

/* Hover-popup content: title, full date + miles, walker badges (same markup as
   the list rows), and a video link when there is one. */
function popupContent(section) {
    const dateStr = section.date ? formatDate(section.date) : "";
    const metaBits = [dateStr, `${section.miles.toFixed(1)} mi`].filter(Boolean);
    let html = `<b>${section.start} → ${section.end}</b><br>${metaBits.join(" · ")}<br>${walkerBadgesHTML(section)}`;
    const hasVideo = section.videoLink && section.videoLink !== "none";
    if (hasVideo) {
        html += `<br><a href="${section.videoLink}" target="_blank" rel="noopener">Watch video</a>`;
    }
    return html;
}

function drawSection(section) {
    const id = section.id;
    const perWalker = {};
    const px = separationPX();
    const displayLatLngs = displayLatLngsForZoom(section);

    WALKERS.forEach(w => {
        if (!section[w]) return;
        const offLatLngs = offsetByPixels(displayLatLngs, WALKER_OFFSETS[w] * px);
        perWalker[w] = makeWalkerLine(offLatLngs, w);
    });

    const tmp = L.polyline(section.latlngs);
    const bounds = tmp.getBounds();
    tmp.remove();

    LINES.set(id, { byWalker: perWalker, bounds });

    // hover tooltip + click to focus
    Object.values(perWalker).forEach(layer => {
        layer.on("mouseover", (e) => {
            if (hoverPopup) map.closePopup(hoverPopup);
            hoverPopup = L.popup({ closeButton: false, className: "hover-popup", offset: [0, -5], autoPan: false })
                .setLatLng(e.latlng)
                .setContent(popupContent(section))
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

/* ====== OVERVIEW LAYERS: coverage bands shown instead of per-section strands
   at/below OVERVIEW_MAX_ZOOM ======
   Built once (from route-km intervals, the same way as the sidebar's coverage
   bar — see mergeIntervalsWithTolerance/walkerIntervalsKm/intersectAllIntervals
   in js/header.js) after all sections exist, then only re-simplified (never
   recomputed) on zoomend. Visibility is handled by updateRenderModeVisibility,
   not here. */
let overviewLayers = null;    // { some, all, byWalker: {charlie, olly, dad} } — each an L.polyline
let overviewIntervals = null; // matching route-km intervals, kept around to re-simplify on zoomend

function overviewLineOptions(color, renderer) {
    return {
        color,
        weight: 6,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        renderer,
        interactive: false,
    };
}

/* One merged/intersected interval -> simplified latlngs (or null if empty/degenerate). */
function overviewIntervalLatLngs(startKm, endKm, tolM) {
    if (endKm <= startKm) return null;
    const sliced = turf.lineSliceAlong(ROUTE, startKm, endKm, { units: "kilometers" });
    if (!sliced || !sliced.geometry || sliced.geometry.coordinates.length < 2) return null;
    const simplified = turf.simplify(sliced, { tolerance: metersToDegrees(tolM), highQuality: false, mutate: false });
    const coords = simplified.geometry.coordinates.length >= 2 ? simplified.geometry.coordinates : sliced.geometry.coordinates;
    return coordsToLatLngs(coords);
}

/* A set of disjoint km intervals -> a multi-polyline's latlngs (nested arrays;
   L.polyline draws each inner array as its own disconnected line). */
function overviewIntervalsToLatLngs(intervals) {
    const tolM = 2 * getMetersPerPixel(map); // "about right" at these zooms, per the design brief
    return intervals.map(([a, b]) => overviewIntervalLatLngs(a, b, tolM)).filter(Boolean);
}

function computeOverviewIntervals() {
    const sections = Array.from(SECTIONS_MAP.values());
    const byWalker = {};
    WALKERS.forEach(key => {
        byWalker[key] = mergeIntervalsWithTolerance(walkerIntervalsKm(sections, key), COVERAGE_GAP_TOLERANCE_KM);
    });
    const some = mergeIntervalsWithTolerance(WALKERS.flatMap(k => byWalker[k]), COVERAGE_GAP_TOLERANCE_KM);
    const all = intersectAllIntervals(WALKERS.map(k => byWalker[k]));
    return { some, all, byWalker };
}

/* Re-simplify the existing overview layers' geometry for the current zoom
   (the underlying km intervals never change once built, only how coarsely
   they're drawn). */
function refreshOverviewGeometry() {
    if (!overviewLayers || !overviewIntervals) return;
    overviewLayers.some.setLatLngs(overviewIntervalsToLatLngs(overviewIntervals.some));
    overviewLayers.all.setLatLngs(overviewIntervalsToLatLngs(overviewIntervals.all));
    WALKERS.forEach(w => overviewLayers.byWalker[w].setLatLngs(overviewIntervalsToLatLngs(overviewIntervals.byWalker[w])));
}

/* Build (once) the overview polylines: the union ("some of us") on
   overviewRenderer, with the intersection ("all three") on overviewTopRenderer
   — a separate canvas so it reliably paints above "some" wherever they
   overlap, regardless of which gets added to the map first — plus one
   per-walker layer for when a walker is hovered/pinned. None of this is added
   to the map here; visibility is entirely updateRenderModeVisibility's job.
   Called from drawAllSections, once sections (and so header.js's interval
   helpers) are ready to use. */
function buildOverviewLayers() {
    overviewIntervals = computeOverviewIntervals();

    if (!overviewLayers) {
        overviewLayers = {
            some: L.polyline([], overviewLineOptions(mapToken("--walked-some"), overviewRenderer)),
            all: L.polyline([], overviewLineOptions(mapToken("--walked-all"), overviewTopRenderer)),
            byWalker: {},
        };
        WALKERS.forEach(w => {
            overviewLayers.byWalker[w] = L.polyline([], overviewLineOptions(rgba(w, 1), overviewRenderer));
        });
    }
    refreshOverviewGeometry();
}

function drawAllSections() {
    TRIPS.forEach(trip => trip.sections.forEach(drawSection));
    buildOverviewLayers();
}

function scheduleRefreshOffsets() {
    if (rafRefresh) return;
    rafRefresh = requestAnimationFrame(() => {
        rafRefresh = null;

        // Corridor thickness in metres for this zoom, and the matching pixel separation
        // (separationPX() is the single source of truth shared with drawSection, so the
        // initial draw and this refresh never disagree on the low-zoom gap).
        const corridorMeters = getWalkerWeight();
        const pxSep = separationPX();

        SECTIONS_MAP.forEach(sec => {
            const entry = LINES.get(sec.id);
            if (!entry) return;

            const displayLatLngs = displayLatLngsForZoom(sec);
            Object.entries(entry.byWalker).forEach(([w, layer]) => {
                layer.setLatLngs(offsetByPixels(displayLatLngs, WALKER_OFFSETS[w] * pxSep));
                layer.setCorridor(corridorMeters);
            });
        });
    });
}

/* ====== Map-side walker filtering ====== */
function toggleLayer(layer, show) {
    if (show && !map.hasLayer(layer)) layer.addTo(map);
    else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
}

/* Show/hide walk-boundary dots vs. path-end dots for the current zoom, and (for
   walk-boundary dots) the effective walker filter. Single source of truth, called
   both when the walker filter changes and on zoomend. */
function applyMarkerVisibility() {
    const showWalkMarkers = map.getZoom() >= DETAIL_ZOOM;
    const who = effectiveMapWalker();
    MARKERS.forEach((markers, id) => {
        const sec = SECTIONS_MAP.get(id);
        const show = showWalkMarkers && (!who || (sec && !!sec[who]));
        markers.forEach(mk => toggleLayer(mk, show));
    });
    endMarkers.forEach(mk => toggleLayer(mk, !showWalkMarkers));
}

/* Single source of truth for which of the two rendering modes is on screen:
   per-section strands (LINES) in detail mode, or the overview coverage bands
   in overview mode (see isOverviewZoom). Also keeps the legend in step
   (updateLegendContent). Called both when the walker filter changes
   (applyMapFilter) and on zoomend (handleZoomChange). */
function updateRenderModeVisibility() {
    const overview = isOverviewZoom();
    const who = effectiveMapWalker();

    LINES.forEach(entry => {
        Object.entries(entry.byWalker).forEach(([w, layer]) => {
            toggleLayer(layer, !overview && (!who || w === who));
        });
    });

    if (overviewLayers) {
        toggleLayer(overviewLayers.some, overview && !who);
        toggleLayer(overviewLayers.all, overview && !who);
        WALKERS.forEach(w => toggleLayer(overviewLayers.byWalker[w], overview && who === w));
    }

    updateLegendContent();
}

/* Show only the effective walker's corridors + markers on the map (null = all). */
function applyMapFilter() {
    updateRenderModeVisibility();
    applyMarkerVisibility();
    scheduleRefreshOffsets();
}

/* ====== MARKERS ====== */
let endMarkers = []; // the two path-end dots (Minehead / South Haven Point); not in MARKERS

function makeWalkMarker(latlng, label) {
    return L.circleMarker(latlng, {
        radius: 4,
        weight: 1.5,
        color: mapToken("--ink"),
        fillColor: mapToken("--surface"),
        fillOpacity: 1,
        renderer: canvasRenderer,
    }).bindTooltip(label, { direction: "top", offset: [0, -6], className: "walk-marker-tooltip" });
}

function makeEndMarker(latlng, label) {
    return L.circleMarker(latlng, {
        radius: 5,
        weight: 1.5,
        color: mapToken("--ink"),
        fillColor: mapToken("--surface"),
        fillOpacity: 1,
        renderer: canvasRenderer,
    }).bindTooltip(label, { permanent: true, direction: "top", offset: [0, -7], className: "end-marker-tooltip" });
}

/* The two ends of the whole path, labelled, shown only below the detail zoom. */
function createEndMarkers() {
    if (!ROUTE) return;
    const coords = ROUTE.geometry.coordinates;
    if (coords.length < 2) return;
    endMarkers = [
        makeEndMarker(toLatLng(coords[0]), "Minehead"),
        makeEndMarker(toLatLng(coords[coords.length - 1]), "South Haven Point"),
    ];
}

/* Start marker for each section, plus an end marker where fixEnd is set.
   Shown only at/above the detail zoom (see applyMarkerVisibility). */
function createMarkers() {
    TRIPS.forEach(trip => {
        trip.sections.forEach(d => {
            const marks = [makeWalkMarker(d.startCoords, d.start)];
            if (d.fixEnd) marks.push(makeWalkMarker(d.endCoords, d.end));
            MARKERS.set(d.id, marks);
        });
    });
    createEndMarkers();
}

/* Everything that depends on the current zoom level, besides corridor offsets
   (which scheduleRefreshOffsets already handles on its own zoomend listener). */
function handleZoomChange() {
    updateRouteDetail();
    applyMarkerVisibility();
    updateWholePathVisibility();
    if (isOverviewZoom()) refreshOverviewGeometry();
    updateRenderModeVisibility();
}

/* keep three lines separated at any zoom/pan (pixel-space offsets) */
function wireMapEvents() {
    map.on("zoomend", scheduleRefreshOffsets);
    map.on("moveend", scheduleRefreshOffsets);
    map.on("zoomend", handleZoomChange);
    scheduleRefreshOffsets();
    handleZoomChange();
}
