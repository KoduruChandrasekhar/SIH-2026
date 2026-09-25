# Trace Net — City-Wide AI Engine for Multi-Camera ANPR Trajectory Tracking & Urban Traffic Analytics

**Trace Net** is a centralized AI-powered traffic intelligence platform designed for **Smart India Hackathon (SIH) 2026**, addressing **Problem Statement ID 26127** by **Bharat Electronics Limited (BEL)**.

The platform is designed to eliminate isolated CCTV/ANPR camera silos by connecting geographically distributed camera feeds into a unified system for **ANPR/OCR, vehicle trajectory reconstruction, multi-camera tracking, city-wide traffic analytics, GIS visualization, and real-time alerts**.

---

## 🚨 Smart India Hackathon 2026

| Details                  | Information                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| **Hackathon**            | Smart India Hackathon (SIH) 2026                                                          |
| **Problem Statement ID** | 26127                                                                                     |
| **Problem Statement**    | City-Wide AI Engine for Multi-Camera ANPR Trajectory Tracking and Urban Traffic Analytics |
| **Organization**         | Bharat Electronics Limited (BEL)                                                          |
| **Department**           | Bharat Electronics Limited                                                                |
| **Category**             | Software                                                                                  |
| **Theme**                | Smart Automation                                                                          |

### Problem Statement

Modern urban environments operate large networks of CCTV and Automatic Number Plate Recognition (ANPR) cameras. However, many existing systems process individual camera feeds independently, making it difficult to connect vehicle observations across different locations and time periods.

Trace Net addresses this challenge through a centralized software architecture capable of:

* High-accuracy ANPR and OCR
* Multi-camera vehicle identification
* Spatial-temporal trajectory reconstruction
* GIS-based vehicle movement visualization
* City-wide traffic flow analytics
* Traffic density and congestion analysis
* Origin-Destination movement analysis
* Real-time alerts for blacklisted vehicles and route anomalies

---

# 🌐 What is Trace Net?

Trace Net acts as a centralized intelligence layer between distributed camera infrastructure and traffic-control operators.

Instead of treating every ANPR camera as an isolated system, Trace Net combines observations from multiple cameras to build a unified understanding of vehicle movement and traffic behavior.

```text
                 CITY CAMERA NETWORK
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Camera 1       Camera 2       Camera N
          │              │              │
          └──────────────┼──────────────┘
                         │
                    ANPR / OCR
                         │
                Vehicle Detection
                         │
              Vehicle Re-Identification
                         │
              Spatial-Temporal Engine
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     Trajectories    Traffic Flow     Alerts
          │              │              │
          └──────────────┼──────────────┘
                         │
                  TRACE NET PLATFORM
                         │
          ┌──────────────┼──────────────┐
          │              │              │
        GIS          Analytics       Dashboard
```

---

# ✨ Core Features

## 1. High-Accuracy ANPR & OCR Engine

The ANPR/OCR layer is designed to detect and recognize vehicle license plates from distributed traffic-camera feeds.

### Capabilities

* License plate detection
* OCR-based plate recognition
* Confidence scoring
* Multi-lane traffic support
* Angled vehicle/plate recognition
* Motion-blur handling
* Poor-lighting scenarios
* Dirty or partially damaged plates
* Vehicle metadata extraction

The solution targets the **greater-than-90% recognition accuracy requirement** specified in the SIH problem statement.

> Actual model accuracy will depend on the trained model, dataset, camera quality and deployment environment.

---

# 2. Multi-Camera Vehicle Tracking

Trace Net goes beyond detecting a vehicle at a single camera.

The system is designed to associate observations of the same vehicle across geographically distributed ANPR cameras.

### Example

```text
CAM #401
Kukatpally
16:02:14
     │
     ▼
CAM #402
Kukatpally
16:07:42
     │
     ▼
CAM #403
Balanagar
16:14:31
     │
     ▼
CAM #406
Cyberabad
16:26:05
```

This creates a chronological movement history for a vehicle.

### Tracking Information

* License plate
* Camera ID
* Timestamp
* Camera location
* Direction
* Estimated speed
* Detection confidence
* Previous camera
* Next camera
* Complete reconstructed route

---

# 3. Spatial-Temporal Trajectory Reconstruction

Trace Net reconstructs vehicle movement using two dimensions:

### Spatial

Where was the vehicle detected?

```text
Camera → Location → Road → Sector
```

### Temporal

When was the vehicle detected?

```text
Timestamp 1
     ↓
Timestamp 2
     ↓
Timestamp 3
     ↓
Timestamp 4
```

Combining both allows Trace Net to reconstruct a vehicle's journey across the city.

---

# 4. GIS-Based Tracking

The platform provides a GIS interface for visualizing:

* ANPR camera locations
* Vehicle trajectories
* Camera-to-camera movement
* Traffic corridors
* Congestion zones
* Traffic density
* City sectors
* Vehicle movement history

The frontend uses **Leaflet** for interactive map visualization.

The dashboard provides a lightweight map preview, while the dedicated GIS page provides the operational map interface.

---

# 5. Macro Traffic Flow Analytics

Trace Net aggregates information from multiple camera nodes to understand city-wide traffic behavior.

### Analytics include

* Vehicle counts
* Traffic density
* Average speed
* Traffic flow
* Corridor utilization
* Congestion detection
* Peak traffic periods
* Sector-wise movement
* Route density
* Origin-Destination patterns

Example:

```text
Kukatpally
     │
     │  2,840 vehicles
     ▼
Balanagar
     │
     │  1,920 vehicles
     ▼
Cyberabad / Madhapur
```

This enables traffic authorities to understand not only **what is happening at one camera**, but also **how traffic is moving across the city**.

---

# 6. Origin-Destination Analytics

The platform can aggregate camera observations to identify movement between city sectors.

Example:

| Origin       | Destination | Vehicles | Flow     |
| ------------ | ----------- | -------: | -------- |
| Kukatpally   | Balanagar   |    2,840 | High     |
| Balanagar    | Cyberabad   |    1,920 | Medium   |
| Kukatpally   | Madhapur    |    1,540 | High     |
| Secunderabad | Begumpet    |    1,120 | Moderate |

This can be visualized using:

* Flow lines
* Sector maps
* OD matrices
* Density indicators
* Traffic heatmaps

---

# 7. Congestion Detection

Trace Net can identify traffic bottlenecks using aggregated camera information.

The system can consider:

* Vehicle density
* Average speed
* Flow rate
* Historical traffic patterns
* Sudden traffic increases
* Camera-level congestion states

Example:

```text
NORMAL
55 km/h
     ↓
MODERATE
48 km/h
     ↓
HIGH
36 km/h
     ↓
CONGESTION
< 30 km/h
```

---

# 8. Alert & Threat Monitoring

Trace Net includes an alert layer for high-interest vehicle and traffic events.

### Alert categories

* Blacklisted vehicle detection
* Suspicious route
* Abnormal vehicle movement
* Repeated route deviation
* Congestion spike
* ANPR confidence drop
* Camera anomaly
* High-density traffic event

Example:

```text
⚠ BLACKLIST MATCH

Vehicle:
TS09AB4521

Camera:
CAM #402

Time:
16:07:42

Confidence:
98.2%

Action:
Priority Alert
```

---

# 🖥️ Frontend Dashboard

The current frontend is designed as a clean enterprise-style command interface.

### Main dashboard

The dashboard provides:

* Trace Net navigation
* Platform overview
* Tracking module
* Traffic analytics module
* Dashboard access
* Alert center
* GIS overview
* System status

The design intentionally uses a minimal **white / black / gray visual system** with limited traffic-state colors.

---

# 🗺️ GIS Command Center

The dedicated GIS page provides the operational visualization layer.

### GIS features

* Interactive Leaflet map
* Camera markers
* Camera selection
* Camera search
* Zone selection
* Camera-level traffic information
* Speed information
* Traffic-density indicators
* Live monitoring state
* Map controls
* Selected camera information
* Traffic status legend

Traffic states are represented using:

| Color     | Meaning                     |
| --------- | --------------------------- |
| 🟢 Green  | Low / Normal traffic        |
| 🟡 Yellow | Moderate traffic            |
| 🔴 Red    | High congestion             |
| 🔵 Blue   | Information / tracked state |

---

# 🎨 UI / UX

Trace Net uses a minimal enterprise dashboard design inspired by modern command-center interfaces.

### Design principles

* Clean white background
* Rounded cards
* Subtle borders
* Minimal shadows
* Plus Jakarta Sans typography
* Lucide icons
* Responsive layouts
* Smooth card hover effects
* Page entrance animations
* GIS visualization
* Clear traffic-state indicators

The UI is built using **Tailwind CSS**.

---

# 🛠️ Technology Stack

## Frontend

* React.js
* Vite
* JavaScript / JSX
* Tailwind CSS
* Lucide React

## GIS / Mapping

* Leaflet
* OpenStreetMap

## Frontend Architecture

* React Hooks
* Component-based architecture
* Custom application navigation
* Centralized data configuration
* Reusable UI components

## Planned / Integratable AI Backend

The frontend is designed to integrate with an AI backend containing components such as:

* Python
* FastAPI
* YOLO-based vehicle detection
* ANPR/OCR models
* Vehicle re-identification
* OpenCV
* PostgreSQL / PostGIS
* Redis
* REST APIs
* WebSocket-based live updates

---

# 📁 Project Structure

```text
trace-net/
│
├── public/
│
├── src/
│   │
│   ├── components/
│   │   ├── Modal.jsx
│   │   ├── Navbar.jsx
│   │   └── Shell.jsx
│   │
│   ├── pages/
│   │   ├── HomePage.jsx
│   │   └── DashboardPage.jsx
│   │
│   ├── data.js
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
│
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
└── README.md
```

---

# 📦 Installation

## Prerequisites

Make sure the following are installed:

* Node.js 16+
* npm
* Git

Check your versions:

```bash
node --version
npm --version
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-username/trace-net.git
```

Move into the project:

```bash
cd trace-net
```

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Run the Development Server

```bash
npm run dev
```

---

## 4. Open the Application

Open:

```text
http://localhost:5173
```

---

# 🔧 Available Commands

### Start development server

```bash
npm run dev
```

### Build production version

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

---

# 🔌 Backend Integration Architecture

The frontend can communicate with the AI/backend layer through REST APIs and WebSockets.

Example architecture:

```text
                    React Frontend
                          │
             ┌────────────┴────────────┐
             │                         │
          REST API                  WebSocket
             │                         │
             └────────────┬────────────┘
                          │
                       FastAPI
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
      ANPR             Tracking          Analytics
        │                 │                 │
      OCR              Re-ID             Traffic
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                     Database
                          │
                  PostgreSQL/PostGIS
```

---

# 📡 Example API Structure

The backend can expose endpoints such as:

```text
GET  /api/cameras
GET  /api/cameras/{camera_id}

GET  /api/vehicles
GET  /api/vehicles/{plate}

GET  /api/vehicles/{plate}/trajectory

GET  /api/traffic
GET  /api/traffic/density

GET  /api/traffic/heatmap

GET  /api/alerts
GET  /api/alerts/active

POST /api/anpr/process
```

For live events:

```text
WebSocket
/ws/traffic
/ws/anpr
/ws/alerts
/ws/vehicles
```

---

# 🔐 Privacy & Security Considerations

Because ANPR systems process potentially sensitive vehicle information, a production deployment should incorporate appropriate security and governance controls.

Recommended measures include:

* Role-based access control
* Authentication and authorization
* Encrypted API communication
* Secure database storage
* Audit logs
* Data retention policies
* Access logging
* Controlled operator permissions
* Secure camera endpoints
* Protection of plate and vehicle information

The system should be deployed according to applicable laws, regulations, organizational policies and authorized surveillance requirements.

---

# 📈 Scalability

Trace Net is designed around a modular architecture so additional camera networks can be incorporated without redesigning the frontend.

```text
10 Cameras
    ↓
100 Cameras
    ↓
1,000 Cameras
    ↓
City-Wide Camera Network
```

The architecture can be extended using:

* Distributed inference
* GPU-based AI processing
* Message queues
* Event streaming
* Database indexing
* Geographic partitioning
* Horizontal API scaling
* WebSocket event distribution
* Caching

---

# 🚀 Future Enhancements

Planned enhancements include:

* [ ] Live CCTV video integration
* [ ] Real-time ANPR inference
* [ ] YOLO vehicle detection
* [ ] Advanced OCR integration
* [ ] Vehicle re-identification model
* [ ] Real-time trajectory reconstruction
* [ ] Live traffic heatmaps
* [ ] Dynamic OD matrices
* [ ] Historical traffic playback
* [ ] Blacklist database integration
* [ ] Real-time WebSocket alerts
* [ ] Role-based authentication
* [ ] Operator management
* [ ] Advanced analytics dashboard
* [ ] PostgreSQL/PostGIS integration
* [ ] Multi-city deployment
* [ ] Cloud/edge deployment support

---

# 🧪 Current Frontend Status

The current repository provides the **Trace Net frontend and interactive prototype layer**.

Currently implemented in the frontend:

* ✅ Trace Net dashboard UI
* ✅ Responsive navigation
* ✅ Tracking module interface
* ✅ Traffic analytics interface
* ✅ Dashboard interface
* ✅ Alert interface
* ✅ GIS overview
* ✅ Dedicated GIS page
* ✅ Interactive Leaflet map
* ✅ Camera markers
* ✅ Camera selection
* ✅ Zone selection
* ✅ Camera search
* ✅ Traffic status visualization
* ✅ Modal interactions
* ✅ Animated UI components
* ✅ Mock telemetry and camera data

The current `data.js` contains representative/mock telemetry for demonstrating the interface. Production deployment requires connecting these interfaces to the actual ANPR, tracking, analytics and alert-processing backend.

---

# 🎯 SIH Problem Statement Mapping

Trace Net maps directly to the major requirements of **SIH 2026 Problem Statement 26127**.

| Problem Requirement         | Trace Net Component        |
| --------------------------- | -------------------------- |
| High-Accuracy ANPR & OCR    | ANPR/OCR Engine            |
| Multi-camera processing     | Centralized Camera Network |
| Vehicle trajectory          | Spatial-Temporal Tracking  |
| Historical vehicle movement | Trajectory Reconstruction  |
| GIS visualization           | GIS Command Center         |
| Traffic density             | Traffic Analytics          |
| Origin-Destination patterns | OD Analytics               |
| Congestion detection        | Traffic Flow Engine        |
| Heatmaps                    | GIS Traffic Visualization  |
| Blacklisted vehicles        | Alert System               |
| Suspicious route anomalies  | Anomaly Detection          |
| Centralized dashboard       | Trace Net Dashboard        |

---

# 🏆 Why Trace Net?

Traditional camera systems often operate as independent silos.

Trace Net focuses on connecting these observations into a single intelligence layer.

```text
Individual Cameras
       ↓
Individual Detections
       ↓
Centralized Intelligence
       ↓
Vehicle Trajectory
       ↓
Traffic Intelligence
       ↓
Actionable Alerts
```

The goal is to transform existing camera infrastructure from a collection of isolated feeds into a **city-wide traffic intelligence network**.

---

# 👥 Hackathon

Built for:

**Smart India Hackathon 2026**

### Problem Statement

**26127 — City-Wide AI Engine for Multi-Camera ANPR Trajectory Tracking and Urban Traffic Analytics**

### Organization

**Bharat Electronics Limited (BEL)**

### Category

**Software**

### Theme

**Smart Automation**

---

# 📄 Disclaimer

Trace Net is a hackathon project/prototype developed for demonstrating the proposed architecture and solution for the SIH 2026 problem statement.

Performance figures, vehicle records, camera telemetry and geographic data shown in the frontend may represent mock/demo data unless explicitly connected to validated real-world datasets and production AI models.

Actual ANPR accuracy, tracking performance, latency and scalability depend on the deployed models, hardware, camera infrastructure, datasets and operating environment.

---

# ⭐ Trace Net

**Centralized AI. Connected Cameras. Complete Traffic Intelligence.**

Built for **Smart India Hackathon 2026 — Problem Statement 26127**.

---

# 🎥 Phase 1 — Multi-Camera Video Ingestion & Simulation

Recorded MP4 files act as the simulation layer for the city camera network. The ingestion
layer decodes them, attaches camera metadata and deterministic timestamps, and emits
standardized `FramePacket`s for Phase 2 (ANPR/OCR).

```bash
python -m backend.ingestion.cli --list                 # configured cameras
python -m backend.ingestion.cli --demo                 # replay the whole network
python -m backend.ingestion.cli --camera CAM-401       # one camera
python -m pytest backend/tests/test_phase1_ingestion.py -v
```

Camera network: `backend/config/cameras.json` (CAM-401, CAM-402, CAM-403, CAM-406).
Live ingestion state is served at `/api/ingestion/cameras` and shown on the Cameras page.

**Full documentation: [docs/PHASE1_INGESTION.md](docs/PHASE1_INGESTION.md)**

---

# 🔎 Phase 2 — High-Accuracy ANPR / OCR

Vehicle tracks from YOLO11 + ByteTrack feed a plate pipeline: plate candidate
(geometric fallback until a plate model is added) → pixel-only Q-score → best 2–3 crops
per vehicle → CLAHE → PaddleOCR (bilateral retry below 0.85) → Indian STANDARD/BH
validation with positional correction → multi-frame consensus → structured observation.

```bash
python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --anpr
python -m pytest backend/tests/test_phase2_anpr.py -v
```

Results: `backend/output/anpr/<CAM>_anpr.json` + evidence crops, served at `/api/anpr`,
`/api/anpr/{track_id}` and `/api/cameras/{id}/anpr`.

**Full documentation: [docs/PHASE2_ANPR.md](docs/PHASE2_ANPR.md)**

---

# 🧭 Phase 3 — Cross-Camera Identity & Trajectory Fusion

Phase 2 sightings are fused into city-wide trajectories: normalised-Levenshtein plate
similarity + 512-D appearance cosine + road-network kinematics (OSRM distances), ghost-car
weight redistribution, cloned-plate alerts (>150 km/h), deterministic UUIDv5 vehicle IDs.
Redis / RabbitMQ are used when running; otherwise in-memory state and direct mode.

```bash
python -m backend.fusion.cli --scenarios      # 4 golden scenarios
python -m backend.fusion.cli --demo           # fuse the real Phase 2 sightings
python -m pytest backend/tests/test_phase3_fusion.py -v
```

API: `/api/v1/trajectories`, `/api/v1/trajectories/{plate_or_id}`, `/api/v1/alerts/anomalies`.

**Full documentation: [docs/PHASE3_FUSION.md](docs/PHASE3_FUSION.md)**

---

# 🗺️ Phase 4 — PostGIS Storage & GIS Vehicle Trace

Fused journeys are stored in PostgreSQL 16 + PostGIS 3.4 (`LineString` + epoch `LineStringM`),
served by an asyncpg API with pg_trgm/levenshtein fuzzy search and a hash-chained audit log,
and drawn on the Tracking page map from the returned GeoJSON.

```bash
docker compose up -d postgis
python backend/scripts/seed_db.py --migrate
python -m backend.fusion.cli --demo --store postgres
python -m pytest backend/tests/test_phase4_postgis.py -v
```

API: `/api/v1/vehicles/{plate}/trajectory`, `/api/v1/search?q=`, `/api/v1/geo/observations`, `/api/v1/audit/verify`.

**Full documentation: [docs/PHASE4_POSTGIS.md](docs/PHASE4_POSTGIS.md)**

---

# 📈 Phase 5 — Macro Traffic Analytics (Polars)

A background job (asyncio task, every 45 s) reads observations and trajectories from PostGIS
with connectorx into Polars and computes per-junction density, speed, OCR yield, the Bottleneck
Congestion Index (BCI = 1 − v/60) and a 24 h O-D matrix into `corridor_stats` / `od_matrix`.
The Traffic and Dashboard pages render these instead of mock stats.

```bash
python -m uvicorn backend.main:app --port 8000     # scheduler starts with the API
python -m backend.analytics.polars_jobs            # one run, printed
python -m pytest backend/tests/test_phase5_analytics.py -v
```

API: `/api/v1/geo/heatmap`, `/api/v1/analytics/od-matrix`, `/api/v1/analytics/summary`, `/api/v1/analytics/hourly`.

**Full documentation: [docs/PHASE5_ANALYTICS.md](docs/PHASE5_ANALYTICS.md)**

---

# 🚨 Phase 6 — Real-Time Alerts, RBAC & End-to-End Demo

JWT auth with role-based access control, where the audit log records the JWT user.
Posted sightings are fused live and raise `CLONED_PLATE`, `BLACKLIST_HIT` (from the watchlist) and `INVALID_FORMAT` alerts.
The alerts reach the React app over `ws://localhost:8000/ws/alerts?token=<JWT>` as toasts plus Alerts-table rows, with no refresh.

| User | Password | Role |
|---|---|---|
| `officer` | `police123` | `law_enforcement` (trajectories, search, alerts, watchlist) — the React app signs in as this user automatically |
| `admin` | `admin123` | `camera_admin` (camera control, sighting ingest, analytics refresh) |

```bash
docker compose up -d postgis
python -m uvicorn backend.main:app --port 8000
npm run dev
python backend/scripts/run_demo.py        # golden scenarios over HTTP → live WebSocket alerts, with checks
python -m pytest backend/tests/test_phase6_realtime.py -v
```

**Full documentation: [docs/PHASE6_REALTIME.md](docs/PHASE6_REALTIME.md)**
