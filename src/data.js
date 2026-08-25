export const slides = [
  {
    title: "About",
    desc:
      "Modern cities are full of isolated camera feeds. Trace Net integrates them using centralized AI for complete traffic visibility. This is a multi-camera ANPR trajectory and traffic flow analytics platform.",
  },
  {
    title: "High-Accuracy ANPR & OCR Engine",
    desc:
      "Optical Recognition Core: Deep learning model achieving >90% precision across harsh environmental conditions, angled shots, motion blur, and damaged license plates.",
  },
  {
    title: "Macro Traffic Flow Analytics",
    desc:
      "City Dynamics: Aggregates cross-sector camera feeds to continuously map density, plot origin-destination matrices, and detect congestion bottlenecks in real time.",
  },
];

export const areas = [
  {
    name: "Kukatpally",
    title: "Kukatpally Zone",
    sector: "Sector NW-1",
    density: "High (Congestion Detected)",
    speed: "36 km/h",
    cameras: "54 ANPR Cameras",
    accuracy: "95.1%",
    color: "#ff3b30",
    position: [17.4932, 78.3984],
  },
  {
    name: "Balanagar",
    title: "Balanagar Corridor",
    sector: "Sector N-2",
    density: "Moderate",
    speed: "48 km/h",
    cameras: "38 ANPR Cameras",
    accuracy: "93.7%",
    color: "#ffcc00",
    position: [17.5180, 78.4275],
  },
  {
    name: "Cyberabad / Madhapur",
    title: "Cyberabad Hub (Madhapur)",
    sector: "Sector W-4",
    density: "Very High Flow",
    speed: "42 km/h",
    cameras: "72 ANPR Cameras",
    accuracy: "96.4%",
    color: "#007aff",
    position: [17.4483, 78.3915],
  },
  {
    name: "Begumpet",
    title: "Begumpet Central",
    sector: "Sector C-1",
    density: "Moderate Density",
    speed: "40 km/h",
    cameras: "41 ANPR Cameras",
    accuracy: "94.2%",
    color: "#ffcc00",
    position: [17.4440, 78.4670],
  },
  {
    name: "Secunderabad",
    title: "Secunderabad Hub",
    sector: "Sector E-3",
    density: "Normal Flow",
    speed: "55 km/h",
    cameras: "49 ANPR Cameras",
    accuracy: "92.8%",
    color: "#34c759",
    position: [17.4399, 78.4983],
  },
];

export const cameras = [
  {
    id: "CAM #401",
    latitude: 17.4932,
    longitude: 78.3984,
    speed: "34 kph",
    density: "High (84%)",
    trend: "Traffic ↑ 18% since 4:00 PM",
    color: "#e64638",
    flow: [0.4, 0.7, 1.0, 0.8, 0.5],
  },
  {
    id: "CAM #402",
    latitude: 17.4891,
    longitude: 78.4012,
    speed: "28 kph",
    density: "Very High (92%)",
    trend: "Traffic ↑ 24% since 3:30 PM",
    color: "#e64638",
    flow: [0.5, 0.9, 1.15, 0.85, 0.6],
  },
  {
    id: "CAM #403",
    latitude: 17.4855,
    longitude: 78.4120,
    speed: "48 kph",
    density: "Medium (56%)",
    trend: "Traffic ↑ 4% since 4:00 PM",
    color: "#f4be25",
    flow: [0.3, 0.5, 0.7, 0.6, 0.4],
  },
  {
    id: "CAM #404",
    latitude: 17.4810,
    longitude: 78.4055,
    speed: "56 kph",
    density: "Low (32%)",
    trend: "Traffic ↓ 6% since 4:00 PM",
    color: "#52b788",
    flow: [0.2, 0.4, 0.5, 0.3, 0.3],
  },
];
