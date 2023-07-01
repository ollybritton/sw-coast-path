const introPanel = document.getElementById("intro");
const infoPanel = document.getElementById("info");
const infoRoute = document.getElementById("info-route");
const infoDate = document.getElementById("info-date");
const infoLink = document.getElementById("info-link");
const infoNoLink = document.getElementById("info-no-link");
const profileCharlie = document.getElementById("profile-charlie");
const profileOlly = document.getElementById("profile-olly");
const profileDad = document.getElementById("profile-dad");

function updateInfoPanel(data) {
  introPanel.hidden = true;
  infoPanel.hidden = false;

  infoRoute.innerText = `${data.start} to ${data.end}`;

  console.log(data, data.olly);
  if (data.charlie) {
    profileCharlie.hidden = false;
  } else {
    profileCharlie.hidden = true;
  }

  if (data.olly) {
    profileOlly.hidden = false;
  } else {
    console.log("here");
    profileOlly.hidden = true;
  }

  if (data.dad) {
    profileDad.hidden = false;
  } else {
    profileDad.hidden = true;
  }

  if (data.videoLink != "") {
    infoNoLink.hidden = true;
    infoLink.hidden = false;
    infoLink.href = data.videoLink;
  } else {
    infoLink.hidden = true;
    infoNoLink.hidden = false;
  }
}

const map = L.map("map", { attributionControl: false }).setView(
  [51.1069, -3.2245],
  7
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

L.control
  .attribution({
    position: "topright",
  })
  .addTo(map);

// Iterate through the data and add markers for each hiker's progress
HIKE_DATA.forEach((data) => {
  const hikers = [
    {
      name: "Charlie",
      completed: data.charlie,
      color: COLORS.charlie,
      offset: [-0.005, 0.005],
    },
    { name: "Olly", completed: data.olly, color: COLORS.olly, offset: [0, 0] },
    {
      name: "Dad",
      completed: data.dad,
      color: COLORS.dad,
      offset: [0.005, -0.005],
    },
  ];

  const startMarker = L.marker(data.startCoords, {
    title: `${data.start}`,
    icon: L.icon({
      iconUrl: MARKER_ICON_URL,
      shadowUrl: MARKER_SHADOW_URL,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    }),
  }).addTo(map);

  startMarker.bindPopup(`${data.start}`);
  startMarker.on("click", (e) => {
    startMarker.openPopup();
    updateInfoPanel(data);
  });

  if (data.fixEnd) {
    const endMarker = L.marker(data.endCoords, {
      title: `${data.end}`,
      icon: L.icon({
        iconUrl: MARKER_ICON_URL,
        shadowUrl: MARKER_SHADOW_URL,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      }),
    }).addTo(map);

    endMarker.bindPopup(`${data.end}`);
    endMarker.on("click", (e) => {
      endMarker.openPopup();
      updateInfoPanel(data);
    });
  }

  hikers.forEach((hiker) => {
    if (hiker.completed) {
      const startOffsetCoords = [
        data.startCoords[0] + hiker.offset[0],
        data.startCoords[1] + hiker.offset[1],
      ];

      const endOffsetCoords = [
        data.endCoords[0] + hiker.offset[0],
        data.endCoords[1] + hiker.offset[1],
      ];

      const polyline = L.polyline([startOffsetCoords, endOffsetCoords], {
        color: hiker.color,
        weight: 10,
        className: "polyline",
      }).addTo(map);

      polyline.on("click", (e) => {
        updateInfoPanel(data);
      });
    }
  });
});
