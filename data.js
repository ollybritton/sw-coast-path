const MARKER_ICON_URL =
  "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png";

const MARKER_SHADOW_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png";

const COLORS = {
  olly: "blue",
  dad: "green",
  charlie: "red",
};

const HIKE_DATA = [
  {
    start: "Minehead",
    end: "Porlock Weir",
    direction: "S",
    startCoords: [51.21, -3.477],
    endCoords: [51.2178, -3.6266],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "https://www.youtube.com/watch?v=bePFuryxKWk",
  },
  {
    start: "Porlock Weir",
    end: "Lynmouth",
    direction: "S",
    startCoords: [51.2178, -3.6266],
    endCoords: [51.2296, -3.8292],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "https://www.youtube.com/watch?v=LeV3sTSMqbw",
  },
  {
    start: "Lynmouth",
    end: "Coombe Martin",
    direction: "S",
    startCoords: [51.2296, -3.8292],
    endCoords: [51.1995, -4.0243],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "https://www.youtube.com/watch?v=3lI0qnjOysM",
  },
  {
    start: "Coombe Martin",
    end: "Mortehoe",
    direction: "S",
    startCoords: [51.1995, -4.0243],
    endCoords: [51.1853, -4.2089],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "https://www.youtube.com/watch?v=VPTrw9T-YeQ",
  },
  {
    start: "Mortehoe",
    end: "Croyde",
    direction: "S",
    startCoords: [51.1853, -4.2089],
    endCoords: [51.13, -4.2244],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "https://www.youtube.com/watch?v=eb7Jj3PwDmA",
  },
  {
    start: "Croyde",
    end: "Braunton",
    direction: "S",
    startCoords: [51.13, -4.2244],
    endCoords: [51.108, -4.161],
    charlie: false,
    olly: true,
    dad: true,
    videoLink: "",
  },
  {
    start: "Braunton",
    end: "Yelland",
    direction: "S",
    startCoords: [51.108, -4.161],
    endCoords: [51.0688, -4.1524],
    charlie: false,
    olly: true,
    dad: true,
    videoLink: "",
    fixEnd: true,
  },
  {
    start: "Sidmouth",
    end: "Seaton",
    direction: "N",
    startCoords: [50.6787, -3.2376],
    endCoords: [50.7053, -3.0719],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "",
  },
  {
    start: "Seaton",
    end: "Lyme Regis",
    direction: "N",
    startCoords: [50.7053, -3.0719],
    endCoords: [50.7252, -2.9366],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "",
  },
  {
    start: "Lyme Regis",
    end: "West Bay",
    direction: "S",
    startCoords: [50.7252, -2.9366],
    endCoords: [50.7117, -2.7636],
    charlie: true,
    olly: true,
    dad: true,
    videoLink: "",
  },
  {
    start: "West Bay",
    end: "West Bexington",
    direction: "N",
    startCoords: [50.7117, -2.7636],
    endCoords: [50.679, -2.6615],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "West Bexington",
    end: "Bagwell Farm",
    direction: "S",
    startCoords: [50.679, -2.6615],
    endCoords: [50.633, -2.5297],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Bagwell Farm",
    end: "Portland Loop",
    direction: "S",
    startCoords: [50.633, -2.5297],
    endCoords: [50.5142, -2.4594],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Portland Loop",
    end: "Ferrybridge",
    direction: "N",
    startCoords: [50.5142, -2.4594],
    endCoords: [50.5860971, -2.474905],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Ferrybridge",
    end: "Osmington Mills",
    direction: "N",
    startCoords: [50.5860971, -2.474905],
    endCoords: [50.6346, -2.3753],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Osmington Mills",
    end: "Lulworth Cove",
    direction: "N",
    startCoords: [50.6346, -2.3753],
    endCoords: [50.6182, -2.247],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Lulworth Cove",
    end: "Kimmeridge",
    direction: null,
    startCoords: [50.6182, -2.247],
    endCoords: [50.6177, -2.1171],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Kimmeridge",
    end: "Dancing Ledge",
    direction: null,
    startCoords: [50.6177, -2.1171],
    endCoords: [50.592487, -2.00549],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Dancing Ledge",
    end: "Swanage",
    direction: "N",
    startCoords: [50.592487, -2.00549],
    endCoords: [50.6083, -1.9608],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
  },
  {
    start: "Swanage",
    end: "Shell Bay",
    direction: "N",
    startCoords: [50.6083, -1.9608],
    endCoords: [50.6773, -1.9466],
    charlie: true,
    olly: false,
    dad: true,
    videoLink: "",
    fixEnd: true,
  },
];