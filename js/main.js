/* ====== MAIN: boot sequence ====== */
(async function init() {
    try {
        await loadRouteFromContinuousGPX();
    } catch (err) {
        console.error("SW Coast Path: couldn't load route.gpx, so the map and walk list can't be built.", err);
        sectionsListEl.innerHTML = '<p class="silver tiny">Couldn’t load the route data. Try refreshing the page.</p>';
        return;
    }

    buildFromTrips();
    drawAllSections();
    createMarkers();

    // Sidebar UI
    renderTripsList();
    const stats = computeStats();
    renderAvatars(stats);      // images + progress pies
    renderOverall(stats);
    updateAvatarStates();
    wireListControls();

    fitAll();
    wireMapEvents();

    // Everything is drawn and wired; late listeners (deep links etc.) hook onto this.
    document.dispatchEvent(new CustomEvent("app:ready"));
})();
