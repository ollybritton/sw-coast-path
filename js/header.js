/* ====== HEADER: walker avatars, overall progress, path coverage strip, pinned-walker chip ====== */

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

/* ====== AVATARS ====== */
function renderAvatars(stats) {
    walkersAvatarsEl.innerHTML = "";
    Object.entries(stats.perWalker).forEach(([key, w]) => {
        const pct = Math.min(100, (w.miles / ROUTE_MILES) * 100);
        const wrap = document.createElement("div");
        wrap.className = "avatar-wrap";
        wrap.dataset.walker = key;
        wrap.setAttribute("role", "button");
        wrap.setAttribute("tabindex", "0");
        wrap.setAttribute("aria-pressed", "false");
        wrap.title = `Show only ${w.name}'s walks (click to pin)`;
        wrap.innerHTML = `
      <div class="avatar-pie ${key}" style="--pct:${pct}">
        <img src="${w.img}" alt="">
      </div>
      <div class="avatar-label">
        <span class="avatar-name">${w.name}</span>
        <span class="avatar-pct">${Math.round(pct)}%</span>
      </div>
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

function updateAvatarStates() {
    // Pinning is the only thing that dims avatars; hovering only previews the
    // map (via setHoverWalker) and lifts the hovered avatar (CSS :hover).
    const pinned = !!selectedWalker;
    walkersAvatarsEl.querySelectorAll(".avatar-wrap").forEach(el => {
        const w = el.dataset.walker;
        const isSelected = selectedWalker === w;
        el.classList.toggle("selected", isSelected);
        el.classList.toggle("dimmed", pinned && !isSelected);
        el.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
}

/* ====== OVERALL PROGRESS (statement) and ROUTE COVERAGE BAR ====== */

/* Display-only gap bridging: the Padstow-Rock ferry crossing (and route-snapping
   slivers) leave hairline breaks in the bar that aren't real "unwalked" stretches.
   Bridge anything shorter than this when building the bar. Mileage figures
   (computeStats) are untouched and stay exact. */
const COVERAGE_GAP_TOLERANCE_KM = 1.5;

function mergeIntervalsWithTolerance(intervals, toleranceKm) {
    if (!intervals.length) return [];
    const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
    const merged = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        if (sorted[i][0] <= last[1] + toleranceKm) {
            last[1] = Math.max(last[1], sorted[i][1]);
        } else {
            merged.push(sorted[i].slice());
        }
    }
    return merged;
}

function walkerIntervalsKm(sections, key) {
    return sections.filter(s => s[key]).map(s => [s.startKm, s.endKm]);
}

/* Intersection of two sorted, non-overlapping interval arrays (both assumed
   already merged, e.g. via mergeIntervals/mergeIntervalsWithTolerance). */
function intersectIntervals(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        const lo = Math.max(a[i][0], b[j][0]);
        const hi = Math.min(a[i][1], b[j][1]);
        if (lo < hi) out.push([lo, hi]);
        if (a[i][1] < b[j][1]) i++; else j++;
    }
    return out;
}

function intersectAllIntervals(arrays) {
    if (!arrays.length) return [];
    return arrays.reduce((acc, cur) => (acc === null ? cur : intersectIntervals(acc, cur)), null) || [];
}

function routeSegHTML(intervals, totalKm, toneClass) {
    return intervals.map(([a, b]) => {
        const left = Math.max(0, Math.min(100, (a / totalKm) * 100));
        const width = Math.max(0.4, Math.min(100 - left, ((b - a) / totalKm) * 100));
        return `<span class="route-seg ${toneClass}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>`;
    }).join("");
}

const milesOfIntervals = intervals => Math.round(intervals.reduce((sum, [a, b]) => sum + (b - a), 0) * 0.621371);

/* The path unrolled from Minehead (left) to South Haven Point (right) as a single
   sectioned bar. No walker pinned: "some of us" (union of the three, mid tone)
   drawn under "all three" (intersection, accent) on top. Walker pinned: just
   their own coverage, in their colour against the grey. */
function renderRouteBar() {
    const totalKm = ROUTE_MILES / 0.621371;
    if (!totalKm || !SECTIONS_MAP.size) return "";

    const sections = Array.from(SECTIONS_MAP.values());
    const totalMiles = Math.round(ROUTE_MILES);
    const endsHTML = `<div class="coverage-ends" aria-hidden="true"><span>Minehead</span><span>South Haven Point</span></div>`;

    if (selectedWalker) {
        const mine = mergeIntervalsWithTolerance(walkerIntervalsKm(sections, selectedWalker), COVERAGE_GAP_TOLERANCE_KM);
        const segHTML = routeSegHTML(mine, totalKm, selectedWalker);
        const summary = `${WALKER_NAMES[selectedWalker]} has walked ${milesOfIntervals(mine)} of ${totalMiles} miles, from Minehead to South Haven Point.`;

        return `
    <div class="coverage-strip">
      <div class="route-bar"><div class="route-track">${segHTML}</div></div>
      ${endsHTML}
      <div class="coverage-key" aria-hidden="true">
        <span class="key-item"><span class="key-swatch ${selectedWalker}"></span>Walked</span>
        <span class="key-item"><span class="key-swatch none"></span>Not yet</span>
      </div>
      <p class="visually-hidden">${summary}</p>
    </div>
  `;
    }

    const perWalker = WALKERS.map(key => mergeIntervalsWithTolerance(walkerIntervalsKm(sections, key), COVERAGE_GAP_TOLERANCE_KM));
    const someone = mergeIntervalsWithTolerance(perWalker.flat(), COVERAGE_GAP_TOLERANCE_KM);
    const everyone = intersectAllIntervals(perWalker);
    const segHTML = routeSegHTML(someone, totalKm, "some") + routeSegHTML(everyone, totalKm, "all");
    const summary = `From Minehead to South Haven Point: ${milesOfIntervals(everyone)} miles walked by all three of us, ` +
        `${milesOfIntervals(someone)} miles walked by at least one of us, out of ${totalMiles} miles total.`;

    return `
    <div class="coverage-strip">
      <div class="route-bar"><div class="route-track">${segHTML}</div></div>
      ${endsHTML}
      <div class="coverage-key" aria-hidden="true">
        <span class="key-item"><span class="key-swatch all"></span>All three</span>
        <span class="key-item"><span class="key-swatch some"></span>Some of us</span>
        <span class="key-item"><span class="key-swatch none"></span>Not yet</span>
      </div>
      <p class="visually-hidden">${summary}</p>
    </div>
  `;
}

/* Progress statement, then the route coverage bar. Kept under one function
   name/id (#overall-stats) so callers only ever need renderOverall(stats). */
function renderOverall(stats) {
    const w = selectedWalker ? stats.perWalker[selectedWalker] : null;
    const rawMiles = w ? w.miles : stats.overallMiles;
    const total = Math.round(ROUTE_MILES);
    const done = Math.round(rawMiles);
    const pct = total ? Math.round((rawMiles / total) * 100) : 0;

    const lineText = w
        ? `${w.name} · ${done} of ${total} miles · ${pct}%`
        : `${done} of ${total} miles walked · ${pct}% · ${Math.max(0, total - done)} to go`;

    overallStatsEl.innerHTML = `
    <div class="progress-line">${lineText}</div>
    ${renderRouteBar()}
  `;
}

/* ====== PINNED-WALKER CHIP ====== */
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
