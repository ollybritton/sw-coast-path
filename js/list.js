/* ====== LIST: the sidebar list (years → trips → walks) and its controls ======
   Both sort modes render the identical grouped structure (year → trip → walks);
   "recent" (Latest first) just walks that same structure back to front — see
   renderTripsList and the ordering note at the top of js/model.js. */

// Placeholder until the route has loaded and the walks have been sliced (see main.js).
// A quiet three-row skeleton reads as "content is on its way" rather than a bare loading line.
sectionsListEl.innerHTML = `
  <div class="list-skeleton" aria-hidden="true">
    <div class="skeleton-row"><span class="skeleton-bar w60"></span><span class="skeleton-bar w15"></span></div>
    <div class="skeleton-row"><span class="skeleton-bar w45"></span><span class="skeleton-bar w15"></span></div>
    <div class="skeleton-row"><span class="skeleton-bar w70"></span><span class="skeleton-bar w15"></span></div>
  </div>
  <p class="visually-hidden" role="status">Loading walks…</p>
`;

const WATCH_ICON_SVG =
    '<svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true" focusable="false"><path d="M0 0L8 4.5L0 9Z" fill="currentColor"/></svg>';

function hasRealVideo(s) {
    return s.videoLink !== "" && s.videoLink !== "none";
}

function sectionVisible(s) {
    const passVideo = !filterVideosEl.checked || hasRealVideo(s);
    const passWalker = !selectedWalker || !!s[selectedWalker];
    return passVideo && passWalker;
}

/* "22 to 27 Aug 2021" (same month) / "28 Aug to 2 Sep 2021" (same year) /
   "30 Dec 2021 to 3 Jan 2022" (different years) / "22 Aug 2021" (one day).
   Built from whichever of the trip's sections carry a date; "" if none do. */
function tripDateRange(sections) {
    const dates = sections.map(s => s.date).filter(Boolean).sort();
    if (!dates.length) return "";
    const first = dates[0], last = dates[dates.length - 1];
    if (first === last) return formatDate(first);

    const d1 = new Date(first + "T00:00:00");
    const d2 = new Date(last + "T00:00:00");
    const sameYear = d1.getFullYear() === d2.getFullYear();
    const sameMonth = sameYear && d1.getMonth() === d2.getMonth();
    const lastFormatted = formatDate(last);

    if (sameMonth) return `${d1.getDate()} to ${lastFormatted}`;
    if (sameYear) {
        const firstMonthDay = d1.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        return `${firstMonthDay} to ${lastFormatted}`;
    }
    return `${formatDate(first)} to ${lastFormatted}`;
}

/* Walkers present across a set of sections, in a fixed Charlie/Olly/Dad order. */
function tripWalkerList(sections) {
    const present = {};
    sections.forEach(s => WALKERS.forEach(w => { if (s[w]) present[w] = true; }));
    return WALKERS.filter(w => present[w]).map(w => WALKER_NAMES[w]);
}

/* "22 to 27 Aug 2021 · 5 walks · 52 mi · Charlie, Olly, Dad" */
function tripSummaryText(children) {
    const parts = [];
    const range = tripDateRange(children);
    if (range) parts.push(range);
    parts.push(`${children.length} walk${children.length === 1 ? "" : "s"}`);
    const miles = children.reduce((sum, s) => sum + s.miles, 0);
    parts.push(`${Math.round(miles)} mi`);
    const walkers = tripWalkerList(children).join(", ");
    if (walkers) parts.push(walkers);
    return parts.join(" · ");
}

/* Build one walk <li>. Title + date/miles live in one .walk-text block with a
   fixed 2px gap between them, independent of how tall the .walk-marks column
   (badges + Watch/video-status pill) ends up — see css/list.css: without this
   split, a CSS-grid row spanning the taller marks column would stretch the
   title/meta rows apart on any walk with a Watch link. */
function makeSectionLi(s) {
    const li = document.createElement("li");
    li.className = "walk-row";
    li.dataset.id = s.id;
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");

    const text = document.createElement("div");
    text.className = "walk-text";

    const title = document.createElement("div");
    title.className = "walk-title";
    title.textContent = `${s.start} → ${s.end}`;
    text.appendChild(title);

    const dateStr = formatDate(s.date);
    const milesStr = `${s.miles.toFixed(1)} mi`;
    const meta = document.createElement("div");
    meta.className = "walk-meta";
    meta.textContent = dateStr ? `${dateStr} · ${milesStr}` : milesStr;
    text.appendChild(meta);

    li.appendChild(text);

    const marks = document.createElement("div");
    marks.className = "walk-marks";
    // All three walkers, absentees greyed — shared with the map popup (js/helpers.js).
    marks.insertAdjacentHTML("beforeend", walkerBadgesHTML(s));

    const withVideo = hasRealVideo(s);
    if (withVideo) {
        const a = document.createElement("a");
        a.className = "watch-link";
        a.href = s.videoLink;
        a.target = "_blank";
        a.rel = "noopener";
        a.innerHTML = `${WATCH_ICON_SVG}<span>Watch</span>`;
        // Don't also focus the row underneath when the link itself is activated.
        a.addEventListener("click", (e) => e.stopPropagation());
        marks.appendChild(a);
    } else {
        // videoLink === "" means not yet edited; "none" means there never will be one.
        const pill = document.createElement("span");
        pill.className = "video-pill";
        pill.textContent = s.videoLink === "none" ? "No video" : "Unedited";
        marks.appendChild(pill);
    }
    li.appendChild(marks);

    const names = walkerNames(s);
    const labelParts = [`${s.start} to ${s.end}`];
    if (dateStr) labelParts.push(dateStr);
    labelParts.push(milesStr);
    if (names) labelParts.push(names);
    if (withVideo) labelParts.push("video available");
    li.setAttribute("aria-label", labelParts.join(", "));

    li.addEventListener("click", () => focusSection(s.id));
    li.addEventListener("keydown", (e) => {
        if (e.target !== li) return; // let the Watch link's own Enter/click behaviour run
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            focusSection(s.id);
        }
    });

    SECTION_ELEMENT.set(s.id, li);
    return li;
}

/* Grouped by year → trip → walks, always. "trip" (Oldest first) renders
   YEAR_GROUPS as built by js/model.js; "recent" (Latest first) walks the exact
   same structure back to front at every level (years, trips within a year,
   walks within a trip) — the shape and styling never differ, only the order. */
function renderTripsList() {
    sectionsListEl.innerHTML = "";
    SECTION_ELEMENT.clear();

    let count = 0;
    const reverse = sortMode === "recent";
    const groups = reverse ? YEAR_GROUPS.slice().reverse() : YEAR_GROUPS;

    groups.forEach(group => {
        if (!group.trips.some(trip => trip.sections.some(sectionVisible))) return;

        const wrap = document.createElement("div");
        wrap.className = "year-group";
        const h = document.createElement("h2");
        h.className = "year-heading";
        h.textContent = group.year;
        wrap.appendChild(h);

        const trips = reverse ? group.trips.slice().reverse() : group.trips;
        trips.forEach(trip => {
            const ordered = reverse ? trip.sections.slice().reverse() : trip.sections;
            const children = ordered.filter(sectionVisible);
            if (!children.length) return;

            const block = document.createElement("div");
            block.className = "trip-block";

            const header = document.createElement("div");
            header.className = "trip-header";
            header.setAttribute("role", "button");
            header.setAttribute("tabindex", "0");

            const name = document.createElement("h3");
            name.className = "trip-name";
            name.textContent = trip.name;
            header.appendChild(name);

            const summaryText = tripSummaryText(children);
            const summary = document.createElement("p");
            summary.className = "trip-meta";
            summary.textContent = summaryText;
            header.appendChild(summary);

            header.setAttribute("aria-label", `${trip.name}, ${summaryText}`);

            const focusThisTrip = () => focusTrip(children);
            header.addEventListener("click", focusThisTrip);
            header.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    focusThisTrip();
                }
            });
            block.appendChild(header);

            const ul = document.createElement("ul");
            ul.className = "walk-list";
            children.forEach(s => { count++; ul.appendChild(makeSectionLi(s)); });
            block.appendChild(ul);

            wrap.appendChild(block);
        });

        sectionsListEl.appendChild(wrap);
    });

    if (selectedWalker && count === 0) {
        const empty = document.createElement("p");
        empty.className = "list-empty";
        const name = WALKER_NAMES[selectedWalker];
        empty.textContent = filterVideosEl.checked
            ? `No walks for ${name} with a video.`
            : `No walks for ${name}.`;
        sectionsListEl.appendChild(empty);
    }

    sectionsCountEl.textContent = `${count} walk${count === 1 ? "" : "s"}`;
}

/* Nearest scrollable ancestor: the sidebar on desktop, the sheet's list panel on phones. */
function scrollParentOf(el) {
    let n = el.parentElement;
    while (n && n !== document.body) {
        const o = getComputedStyle(n).overflowY;
        if (o === "auto" || o === "scroll") return n;
        n = n.parentElement;
    }
    return null;
}

/* Bring a walk row into view inside its scroll container, centred and clear of the
   sticky year label. Instant for long distances or reduced-motion: a smooth scroll over
   thousands of pixels is slow and is silently cancelled by other layout work. */
function scrollRowIntoView(el) {
    const scroller = scrollParentOf(el);
    if (!scroller) return;
    const row = el.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const margin = 48; // sticky year heading height plus a little air
    const above = row.top < box.top + margin;
    const below = row.bottom > box.bottom;
    if (!above && !below) return;
    const distance = Math.abs(row.top - box.top);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = (reduce || distance > 1500) ? "auto" : "smooth";
    const offset = Math.max(margin, (box.height - row.height) / 2);
    const top = scroller.scrollTop + (row.top - box.top) - offset;
    scroller.scrollTo({ top: Math.max(0, top), behavior });
}

function highlightInSidebar(id) {
    SECTION_ELEMENT.forEach(el => el.classList.remove("active"));
    const el = SECTION_ELEMENT.get(id);
    if (el) {
        el.classList.add("active");
        scrollRowIntoView(el);
    }
}

/* ====== Filters row ======
   Turns the plain checkbox/select markup in index.html into a segmented control +
   toggle chip + count. #filter-videos and #sort-mode stay in the DOM (helpers.js
   captured them at load, and wireListControls's listeners read their values) but
   are visually replaced; the new controls proxy onto them by setting .value /
   .checked and dispatching "change". Runs once, as soon as the DOM is available. */
function buildFilterUI() {
    const filtersEl = document.querySelector(".filters");
    if (!filtersEl || !filterVideosEl || !sortModeEl || !sectionsCountEl) return;

    filtersEl.setAttribute("role", "group");
    filtersEl.setAttribute("aria-label", "Filter and sort walks");

    if (filterVideosEl.parentElement) filterVideosEl.parentElement.classList.add("filters-native-hidden");
    if (sortModeEl.parentElement) sortModeEl.parentElement.classList.add("filters-native-hidden");

    const seg = document.createElement("div");
    seg.className = "seg-control";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "View");
    [["trip", "Oldest first"], ["recent", "Latest first"]].forEach(([value, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "seg-btn";
        btn.dataset.value = value;
        btn.textContent = label;
        btn.setAttribute("aria-pressed", String(sortModeEl.value === value));
        btn.addEventListener("click", () => {
            if (sortModeEl.value === value) return;
            sortModeEl.value = value;
            sortModeEl.dispatchEvent(new Event("change"));
        });
        seg.appendChild(btn);
    });
    // Keep the segmented control in sync with #sort-mode however it changes
    // (our own buttons above, or any other code that sets .value and dispatches).
    sortModeEl.addEventListener("change", () => {
        seg.querySelectorAll(".seg-btn").forEach(b => {
            b.setAttribute("aria-pressed", String(b.dataset.value === sortModeEl.value));
        });
    });

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip-toggle";
    chip.setAttribute("aria-pressed", String(filterVideosEl.checked));
    chip.innerHTML = '<span class="chip-dot" aria-hidden="true"></span><span>With video</span>';
    chip.addEventListener("click", () => {
        filterVideosEl.checked = !filterVideosEl.checked;
        filterVideosEl.dispatchEvent(new Event("change"));
    });
    filterVideosEl.addEventListener("change", () => {
        chip.setAttribute("aria-pressed", String(filterVideosEl.checked));
    });

    const frag = document.createDocumentFragment();
    frag.appendChild(seg);
    frag.appendChild(chip);
    filtersEl.insertBefore(frag, filtersEl.firstChild);

    sectionsCountEl.classList.add("filters-count");
    sectionsCountEl.setAttribute("aria-live", "polite");
}

buildFilterUI();

/* Filter + sort controls above the list */
function wireListControls() {
    filterVideosEl.addEventListener("change", renderTripsList);
    sortModeEl.addEventListener("change", () => { sortMode = sortModeEl.value; renderTripsList(); });
}
