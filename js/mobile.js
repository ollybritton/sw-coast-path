/* ====== VIEW: fitting the map to walks/trips, and the mobile bottom sheet ======
   Sheet states: "peek" (handle only), "half" (~45vh), "open" (~85vh). State is
   expressed as a class on #sidebar (sheet-peek/sheet-half/sheet-open) driving the
   --sheet-h custom property that css/mobile.css turns into `height`. ".closed" is
   kept as a CSS alias of "peek" for any code that still toggles it directly. */

function isMobile() {
    return window.matchMedia("(max-width: 860px)").matches;
}

/* Hash present in the address bar when this script first runs, i.e. before
   fitAll()'s own hash-clearing has a chance to run during boot. Deep-link
   application on "app:ready" reads this instead of location.hash. */
const INITIAL_HASH = (location.hash || "").slice(1);

/* ====== Sheet state ====== */
const SHEET_STATES = ["peek", "half", "open"];
const SHEET_CYCLE = { peek: "half", half: "open", open: "peek" };

let sheetState = "peek";
let currentHeightPx = 64; // px height matching sheetState; used as fit padding

function sheetHeightPx(state) {
    const vh = window.innerHeight;
    if (state === "open") return vh * 0.85;
    if (state === "half") return vh * 0.45;
    return 64; // peek
}

function nearestSheetState(heightPx) {
    let best = "peek", bestDist = Infinity;
    SHEET_STATES.forEach(state => {
        const d = Math.abs(heightPx - sheetHeightPx(state));
        if (d < bestDist) { bestDist = d; best = state; }
    });
    return best;
}

/* Public: set the sheet to a given state. Used by tap-cycling, drag-snap and
   deep-link focusing; also handy for manual testing (setSheetState('open')). */
function setSheetState(state, opts = {}) {
    if (SHEET_STATES.indexOf(state) === -1) return;
    sheetState = state;

    sidebar.classList.remove("sheet-peek", "sheet-half", "sheet-open");
    sidebar.classList.add(`sheet-${state}`);
    sidebar.classList.toggle("closed", state === "peek"); // legacy alias

    sidebar.style.removeProperty("--sheet-h"); // hand control back to the class rule
    sheetHandle.setAttribute("aria-expanded", state === "peek" ? "false" : "true");

    currentHeightPx = sheetHeightPx(state);

    if (!opts.skipRefit) {
        map.invalidateSize();
        refitCurrent();
    }
}

function cycleSheetState() {
    setSheetState(SHEET_CYCLE[sheetState] || "half");
}

/* ====== Drag handle: a real <button>, inserted as the sheet's first child ====== */
function createSheetHandle() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sheet-handle";
    btn.setAttribute("aria-label", "Walks");
    btn.setAttribute("aria-expanded", "false");
    const grabber = document.createElement("span");
    grabber.className = "sheet-grabber";
    grabber.setAttribute("aria-hidden", "true");
    btn.appendChild(grabber);
    sidebar.insertBefore(btn, sidebar.firstChild);
    return btn;
}

const sheetHandle = createSheetHandle();

/* Pointer drag resizes the sheet live; release snaps to the nearest state.
   A tap (no meaningful movement) falls through to the click handler, which
   cycles states instead. */
(function wireHandleDrag(handle) {
    let drag = null; // { pointerId, startY, startHeight, dragging }
    let suppressClick = false;

    handle.addEventListener("pointerdown", (e) => {
        if (e.isPrimary === false) return;
        drag = { pointerId: e.pointerId, startY: e.clientY, startHeight: currentHeightPx, dragging: false };
    });

    handle.addEventListener("pointermove", (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const dy = drag.startY - e.clientY; // dragging up (finger moves up) grows the sheet
        if (!drag.dragging) {
            if (Math.abs(dy) < 6) return;
            drag.dragging = true;
            sidebar.classList.add("dragging");
            try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
        e.preventDefault();
        const min = 64;
        const max = window.innerHeight * 0.85;
        const h = Math.min(max, Math.max(min, drag.startHeight + dy));
        sidebar.style.setProperty("--sheet-h", `${h}px`);
    });

    function endDrag(e) {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const wasDragging = drag.dragging;
        drag = null;
        sidebar.classList.remove("dragging");
        if (wasDragging) {
            suppressClick = true;
            const cs = getComputedStyle(sidebar);
            const h = parseFloat(cs.height);
            setSheetState(nearestSheetState(Number.isFinite(h) ? h : currentHeightPx));
        }
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    handle.addEventListener("click", () => {
        if (suppressClick) { suppressClick = false; return; }
        cycleSheetState();
    });
})(sheetHandle);

/* Redo the current fit once the sheet finishes animating to its new size
   (covers both a tap-cycle and a drag snap; setSheetState already does an
   immediate refit too, so this is a correction for the animated case). */
sidebar.addEventListener("transitionend", (e) => {
    if (e.target !== sidebar || e.propertyName !== "height") return;
    map.invalidateSize();
    refitCurrent();
});

/* Viewport size changes (rotation, mobile browser chrome show/hide) shift what
   the vh-based states mean in px; keep the padding and any open fit in sync. */
window.addEventListener("resize", () => {
    if (!isMobile()) return;
    currentHeightPx = sheetHeightPx(sheetState);
    refitCurrent();
});

/* ====== Fitting ====== */
let lastBounds = null, lastPad = 0.2, lastMinZoom = null;

/* fitBounds that keeps content clear of the mobile bottom sheet, using its
   current on-screen height as bottom padding. Remembers the fit so refitCurrent()
   can redo it after the sheet resizes. */
function fitBoundsAware(bounds, padFactor = 0.2, opts = {}) {
    if (!bounds || !bounds.isValid || !bounds.isValid()) return;
    lastBounds = bounds;
    lastPad = padFactor;
    lastMinZoom = opts.minZoom || null;

    if (isMobile()) {
        map.fitBounds(bounds.pad(padFactor), { paddingBottomRight: [0, currentHeightPx] });
        if (lastMinZoom && map.getZoom() < lastMinZoom) map.setZoom(lastMinZoom);
    } else {
        map.fitBounds(bounds.pad(padFactor));
    }
}

function refitCurrent() {
    if (!lastBounds) return;
    fitBoundsAware(lastBounds, lastPad, { minZoom: lastMinZoom });
}

/* ====== Deep links (#<section-id>, ids come from SECTIONS_MAP) ====== */
function updateHashForSection(id) {
    const target = `#${id}`;
    if (location.hash !== target) history.replaceState(null, "", target);
}

function clearFocusForOverview() {
    currentId = null;
    SECTION_ELEMENT.forEach(el => el.classList.remove("active"));
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id && SECTIONS_MAP.has(id)) focusSection(id);
});

document.addEventListener("app:ready", () => {
    if (INITIAL_HASH && SECTIONS_MAP.has(INITIAL_HASH)) focusSection(INITIAL_HASH);
});

function focusSection(id) {
    currentId = id;
    const entry = LINES.get(id);
    if (!entry) return;
    if (isMobile()) setSheetState("half", { skipRefit: true });
    fitBoundsAware(entry.bounds, 0.25);
    scheduleRefreshOffsets();
    highlightInSidebar(id);
    updateHashForSection(id);
}

/* Focus every section belonging to one trip (triggered by clicking its trip-header). */
function focusTrip(sections) {
    const ids = sections.map(s => s.id).filter(id => LINES.has(id));
    if (!ids.length) return;
    currentId = null;

    let bounds = null;
    ids.forEach(id => {
        const b = LINES.get(id).bounds;
        bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
    });

    if (isMobile()) setSheetState("half", { skipRefit: true });
    fitBoundsAware(bounds, 0.25);
    scheduleRefreshOffsets();

    SECTION_ELEMENT.forEach(el => el.classList.remove("active"));
    ids.forEach(id => {
        const el = SECTION_ELEMENT.get(id);
        if (el) el.classList.add("active");
    });
    const firstEl = SECTION_ELEMENT.get(ids[0]);
    if (firstEl) scrollRowIntoView(firstEl); // defined in js/list.js
}

/* Fit the map to every drawn section (accounts for the bottom sheet on mobile).
   Also the reset point for "no walk focused": clears the deep-link hash and any
   active row highlight. Robust to being called before the map container has a
   size (fitAll() would otherwise leave zoom at 0). */
function fitAll() {
    if (!LINES.size) return;
    const groupBounds = Array.from(LINES.values())
        .reduce((acc, { bounds }) => acc ? acc.extend(bounds) : bounds.pad(0), null); // pad(0) returns a new LatLngBounds
    if (!groupBounds || !groupBounds.isValid()) return;

    clearFocusForOverview();

    const pad = isMobile() ? 0.05 : 0.2;
    const minZoom = isMobile() ? 7 : null;
    const doFit = () => fitBoundsAware(groupBounds, pad, { minZoom });
    doFit();

    const size = map.getSize();
    if (size.x === 0 || size.y === 0 || map.getZoom() === 0) {
        map.once("resize", doFit);
    }
}

/* Initial state: "half", so the first screen shows the map, the progress line and
   the first walk rows together; the handle lets people peek or open from there. */
setSheetState("half", { skipRefit: true });
