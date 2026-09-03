/* ====== MODEL: turn HIKE_DATA trips into sections snapped to the route ======
   Base order throughout is chronological, oldest first: years ascending, trips
   in HIKE_DATA order within a year, walks by date ascending within a trip.
   "Latest first" is produced by js/list.js reversing this same structure at
   render time (years, then trips within a year, then walks within a trip) —
   the grouping itself never changes shape, only its direction. */

function buildFromTrips() {
    TRIPS = [];
    YEAR_GROUPS = [];
    SECTIONS_MAP.clear();

    HIKE_DATA.forEach(trip => {
        const list = [];
        (trip.sections || []).forEach(item => {
            const tookPart = !!(item.charlie || item.olly || item.dad);
            if (!tookPart) return;

            const sliced = sliceOnRoute(item.startCoords, item.endCoords);
            const { startKm, endKm } = sliced;
            let { latlngs, km } = sliced;

            // Personal GPX tracks are off by default (USE_PERSONAL_TRACKS, js/helpers.js):
            // mixing one walker's own recorded track with the others' route-sliced lines
            // would mean mileage and geometry come from different sources depending on
            // who walked it, so every walk uses the route-sliced geometry unless enabled.
            if (USE_PERSONAL_TRACKS && Array.isArray(item.track) && item.track.length >= 2) {
                latlngs = item.track;
                km = turf.length(turf.lineString(item.track.map(toLngLat)), { units: "kilometers" });
            }

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

        // Oldest first within a trip, regardless of the order walks were entered in.
        list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

        if (list.length) {
            const firstWithDate = list.find(s => s.year);
            const year = firstWithDate ? firstWithDate.year : "";
            TRIPS.push({ name: trip.name, year, sections: list });
        }
    });

    // Group by year, oldest first; trips within a year keep HIKE_DATA's order
    // (they were pushed into TRIPS in that order above).
    const byYear = new Map();
    TRIPS.forEach(t => {
        const y = t.year || "Unknown";
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(t);
    });
    YEAR_GROUPS = Array.from(byYear.entries())
        .sort((a, b) => (a[0] + "").localeCompare(b[0] + ""))  // asc: oldest first
        .map(([year, trips]) => ({ year, trips }));
}
