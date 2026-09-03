/* ====== Shared config, DOM handles, state and small helpers ======
   Loaded first. Every other script relies on the globals declared here
   (classic scripts share top-level declarations). */

/* ====== CONFIG ====== */
const ROUTE_URL = "route.gpx";         // stitched continuous GPX
const PRE_DECIMATE_METERS = 5;         // quick dedupe before simplification
const SNAP_TOL_METERS = 20;            // smaller = curvier
// Some walks carry a personal GPX track. Off by default: drawing one walker's own
// track beside the others' route-sliced lines muddies the three-band view.
const USE_PERSONAL_TRACKS = false;

/* ====== DOM ====== */
const mapEl = document.getElementById("map");
const sidebar = document.getElementById("sidebar");

const sectionsListEl = document.getElementById("sections-list");
const sectionsCountEl = document.getElementById("sections-count");
const filterVideosEl = document.getElementById("filter-videos");
const overallStatsEl = document.getElementById("overall-stats");
const walkersAvatarsEl = document.getElementById("walkers-avatars");
const sortModeEl = document.getElementById("sort-mode");
const activeFilterEl = document.getElementById("active-filter");

/* ====== Walker filtering state ====== */
const WALKER_NAMES = { charlie: "Charlie", olly: "Olly", dad: "Dad" };
const WALKERS = ["charlie", "olly", "dad"];
let selectedWalker = null;   // pinned filter (null = everyone); drives list + stats + map
let hoverWalker = null;      // transient hover preview; drives map only
let sortMode = "trip";       // "trip" (grouped) | "recent" (flat, newest first)
function effectiveMapWalker() { return hoverWalker || selectedWalker; }

/* ====== Shared data, built from HIKE_DATA by model.js ====== */
let TRIPS = [];                   // [{ name, year, sections:[...] }]
let YEAR_GROUPS = [];             // [{ year, trips:[...] }]
const SECTIONS_MAP = new Map();   // id -> section object
const LINES = new Map();          // id -> { byWalker, bounds }
const MARKERS = new Map();        // id -> [L.marker, ...] (start, and end if fixEnd)
const SECTION_ELEMENT = new Map();// id -> <li> element
let currentId = null;             // id of the focused section, if any

/* ====== HELPERS ====== */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const makeId = s => `${slug(s.start)}_to_${slug(s.end)}_${s.date || "nodate"}`;
const toLngLat = ([lat, lng]) => [lng, lat];
const toLatLng = ([lng, lat]) => [lat, lng];
const coordsToLatLngs = coords => coords.map(toLatLng);
const metersToDegrees = m => m / 111320;

/* "2021-08-22" -> "22 Aug 2021" (en-GB, no weekday). Empty string for missing dates. */
function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* C / O / D badges for a walk: all three walkers, with the ones who were not
   there marked .absent (greyed). Names are included for screen readers. */
function walkerBadgesHTML(s) {
    const badges = WALKERS.map(w => {
        const on = !!s[w];
        const name = WALKER_NAMES[w];
        return `<span class="walker-badge ${w}${on ? "" : " absent"}" title="${name}${on ? "" : " (not on this walk)"}">` +
            `<span aria-hidden="true">${name[0]}</span>` +
            `<span class="visually-hidden">${name}${on ? "" : " not on this walk"}</span></span>`;
    });
    return `<span class="walker-badges">${badges.join("")}</span>`;
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

// RGB for rgba(), read from the walker colour tokens in css/base.css :root
// (--walker-charlie/--walker-olly/--walker-dad) so the map always matches the
// design system instead of keeping its own hard-coded palette.
function hexToRgbArray(hex, fallback) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) return fallback;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readWalkerRgb(varName, fallback) {
    const styles = getComputedStyle(document.documentElement);
    return hexToRgbArray(styles.getPropertyValue(varName), fallback);
}

const RGB = {
    charlie: readWalkerRgb("--walker-charlie", [220, 38, 38]),   // red-600 fallback
    olly: readWalkerRgb("--walker-olly", [37, 99, 235]),   // blue-600 fallback
    dad: readWalkerRgb("--walker-dad", [22, 163, 74]),   // green-600 fallback
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
