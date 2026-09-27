/**
 * Field test: the full pipeline run on four recorded Indian traffic clips (768 × 432).
 * Generated from the runs' own outputs (backend/output/TEST-*_detections.json, backend/output/anpr/TEST-*_anpr.json,
 * evidence crops) — do not edit by hand. Plate results apply the current validation, plate-ownership and consensus
 * logic to the OCR reads those runs saved.
 */

export const FIELD_TESTS = [
  {
    "id": "TEST-1173",
    "title": "Flyover junction",
    "scene": "A stop line under a metro flyover: cars, autos, buses and two-wheelers pulling away together.",
    "video": "/pipeline/field/test-1173.mp4",
    "poster": "/pipeline/field/test-1173-poster.jpg",
    "source": {
      "width": 768,
      "height": 432,
      "fps": 23.98,
      "frames": 191,
      "seconds": 8.0
    },
    "funnel": [
      {
        "label": "Frames analysed",
        "hint": "every frame of the clip",
        "value": 191
      },
      {
        "label": "Vehicles in view",
        "hint": "average per frame",
        "value": 7
      },
      {
        "label": "Vehicles tracked",
        "hint": "seen in 3+ frames",
        "value": 59
      },
      {
        "label": "Plate located",
        "hint": "vehicles",
        "value": 45
      },
      {
        "label": "Clear enough to read",
        "hint": "passed the quality gate",
        "value": 40
      },
      {
        "label": "Plates read",
        "hint": "validated by vote",
        "value": 1
      }
    ],
    "mix": [
      {
        "label": "SUV",
        "count": 17
      },
      {
        "label": "Two-wheeler",
        "count": 9
      },
      {
        "label": "Hatchback",
        "count": 8
      },
      {
        "label": "Bus",
        "count": 7
      },
      {
        "label": "LCV",
        "count": 6
      },
      {
        "label": "Auto-rickshaw",
        "count": 4
      },
      {
        "label": "Sedan",
        "count": 4
      },
      {
        "label": "MUV",
        "count": 3
      },
      {
        "label": "Truck",
        "count": 1
      }
    ],
    "plates": [
      {
        "text": "DL8CAK0211",
        "confidence": 91.2,
        "reads": 2,
        "view": "/pipeline/field/test-1173-plate1-view.jpg",
        "crop": "/pipeline/field/test-1173-plate1-crop.jpg"
      }
    ]
  },
  {
    "id": "TEST-1443",
    "title": "Rush-hour jam",
    "scene": "Bumper-to-bumper traffic, with plates close to the camera and vehicles packed together.",
    "video": "/pipeline/field/test-1443.mp4",
    "poster": "/pipeline/field/test-1443-poster.jpg",
    "source": {
      "width": 768,
      "height": 432,
      "fps": 60.0,
      "frames": 897,
      "seconds": 14.9
    },
    "funnel": [
      {
        "label": "Frames analysed",
        "hint": "every frame of the clip",
        "value": 897
      },
      {
        "label": "Vehicles in view",
        "hint": "average per frame",
        "value": 8
      },
      {
        "label": "Vehicles tracked",
        "hint": "seen in 3+ frames",
        "value": 145
      },
      {
        "label": "Plate located",
        "hint": "vehicles",
        "value": 112
      },
      {
        "label": "Clear enough to read",
        "hint": "passed the quality gate",
        "value": 95
      },
      {
        "label": "Plates read",
        "hint": "validated by vote",
        "value": 3
      }
    ],
    "mix": [
      {
        "label": "SUV",
        "count": 38
      },
      {
        "label": "Truck",
        "count": 28
      },
      {
        "label": "Two-wheeler",
        "count": 27
      },
      {
        "label": "Bus",
        "count": 21
      },
      {
        "label": "Hatchback",
        "count": 10
      },
      {
        "label": "LCV",
        "count": 9
      },
      {
        "label": "Sedan",
        "count": 8
      },
      {
        "label": "Auto-rickshaw",
        "count": 4
      }
    ],
    "plates": [
      {
        "text": "KA04MY5947",
        "confidence": 99.8,
        "reads": 3,
        "view": "/pipeline/field/test-1443-plate1-view.jpg",
        "crop": "/pipeline/field/test-1443-plate1-crop.jpg"
      },
      {
        "text": "KA40A5855",
        "confidence": 99.2,
        "reads": 6,
        "view": "/pipeline/field/test-1443-plate2-view.jpg",
        "crop": "/pipeline/field/test-1443-plate2-crop.jpg"
      },
      {
        "text": "KA03MT8789",
        "confidence": 84.2,
        "reads": 1,
        "view": "/pipeline/field/test-1443-plate3-view.jpg",
        "crop": "/pipeline/field/test-1443-plate3-crop.jpg"
      }
    ]
  },
  {
    "id": "TEST-2186",
    "title": "Winter smog",
    "scene": "Winter haze on a wide avenue, with electric buses, autos and cars.",
    "video": "/pipeline/field/test-2186.mp4",
    "poster": "/pipeline/field/test-2186-poster.jpg",
    "source": {
      "width": 768,
      "height": 432,
      "fps": 29.97,
      "frames": 648,
      "seconds": 21.6
    },
    "funnel": [
      {
        "label": "Frames analysed",
        "hint": "every frame of the clip",
        "value": 648
      },
      {
        "label": "Vehicles in view",
        "hint": "average per frame",
        "value": 7
      },
      {
        "label": "Vehicles tracked",
        "hint": "seen in 3+ frames",
        "value": 109
      },
      {
        "label": "Plate located",
        "hint": "vehicles",
        "value": 65
      },
      {
        "label": "Clear enough to read",
        "hint": "passed the quality gate",
        "value": 54
      },
      {
        "label": "Plates read",
        "hint": "validated by vote",
        "value": 4
      }
    ],
    "mix": [
      {
        "label": "SUV",
        "count": 26
      },
      {
        "label": "Bus",
        "count": 24
      },
      {
        "label": "Auto-rickshaw",
        "count": 16
      },
      {
        "label": "Hatchback",
        "count": 15
      },
      {
        "label": "Sedan",
        "count": 13
      },
      {
        "label": "Two-wheeler",
        "count": 7
      },
      {
        "label": "Tempo traveller",
        "count": 5
      },
      {
        "label": "Truck",
        "count": 3
      }
    ],
    "plates": [
      {
        "text": "DL2CAX1724",
        "confidence": 99.9,
        "reads": 5,
        "view": "/pipeline/field/test-2186-plate1-view.jpg",
        "crop": "/pipeline/field/test-2186-plate1-crop.jpg"
      },
      {
        "text": "DL12CU7606",
        "confidence": 98.9,
        "reads": 3,
        "view": "/pipeline/field/test-2186-plate2-view.jpg",
        "crop": "/pipeline/field/test-2186-plate2-crop.jpg"
      },
      {
        "text": "DL12CU7249",
        "confidence": 97.9,
        "reads": 3,
        "view": "/pipeline/field/test-2186-plate3-view.jpg",
        "crop": "/pipeline/field/test-2186-plate3-crop.jpg"
      },
      {
        "text": "HR67E9191",
        "confidence": 87.6,
        "reads": 3,
        "view": "/pipeline/field/test-2186-plate4-view.jpg",
        "crop": "/pipeline/field/test-2186-plate4-crop.jpg"
      }
    ]
  },
  {
    "id": "TEST-1372",
    "title": "Overhead arterial",
    "scene": "Six lanes seen from above, with hundreds of vehicles tracked at once.",
    "video": "/pipeline/field/test-1372.mp4",
    "poster": "/pipeline/field/test-1372-poster.jpg",
    "source": {
      "width": 768,
      "height": 432,
      "fps": 29.97,
      "frames": 1070,
      "seconds": 35.7
    },
    "funnel": [
      {
        "label": "Frames analysed",
        "hint": "every frame of the clip",
        "value": 1070
      },
      {
        "label": "Vehicles in view",
        "hint": "average per frame",
        "value": 64
      },
      {
        "label": "Vehicles tracked",
        "hint": "seen in 3+ frames",
        "value": 1122
      }
    ],
    "mix": [
      {
        "label": "Hatchback",
        "count": 453
      },
      {
        "label": "Sedan",
        "count": 367
      },
      {
        "label": "Two-wheeler",
        "count": 92
      },
      {
        "label": "Auto-rickshaw",
        "count": 74
      },
      {
        "label": "LCV",
        "count": 54
      },
      {
        "label": "SUV",
        "count": 28
      },
      {
        "label": "MUV",
        "count": 27
      },
      {
        "label": "Bus",
        "count": 17
      },
      {
        "label": "Truck",
        "count": 5
      },
      {
        "label": "Van",
        "count": 4
      },
      {
        "label": "Tempo traveller",
        "count": 1
      }
    ],
    "plates": []
  }
];
