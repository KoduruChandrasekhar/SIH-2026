# Trace Net Project Context

This file serves as a reference for AI agents working on the Trace Net project to quickly understand the current state, architecture, and goals of the repository.

## Overview
- **Event**: Smart India Hackathon (SIH) 2026
- **Problem Statement ID**: 26127
- **Problem Statement**: City-Wide AI Engine for Multi-Camera ANPR Trajectory Tracking and Urban Traffic Analytics
- **Organization**: Bharat Electronics Limited (BEL)
- **Goal**: Build a centralized intelligence platform that consolidates isolated CCTV/ANPR camera feeds into a unified system for tracking vehicles, traffic analytics, and generating alerts based on AI models (YOLO, ANPR, OCR, Re-ID).

## Architecture
The project currently consists of a frontend and a backend component.

### Frontend
- **Tech Stack**: React.js, Vite, Tailwind CSS, Lucide React, Leaflet (for GIS mapping).
- **Location**: `src/`, `public/`, `index.html`
- **Key Features**:
  - `src/lib/api.js`: Handles API calls to the FastAPI backend. It gracefully falls back to local mock data (from `src/data/data.js` and `src/data/demoData.js`) if the backend is down.
  - Dashboards for vehicle tracking, traffic flow analytics, GIS mapping, and active alerts.
  - Supports Dark/Light mode and responsive layouts.
- **Run Command**: `npm run dev`

### Backend
- **Tech Stack**: Python, FastAPI, Uvicorn.
- **Location**: `backend/` directory.
- **Key Features**:
  - Exposes REST APIs (e.g., `/api/vehicles`, `/api/traffic`, `/api/alerts`, `/api/cameras`) for the frontend.
  - Currently serving the same mock data as the frontend (`backend/data.py`).
  - Set up with CORS to allow connections from local Vite servers.
- **Run Command**: `python backend/main.py`

## Current Status (Branch: `backend` / `dev`)
- The `dev` and `backend` branches are currently identical (at commit `dfce601`).
- The frontend interface is well-developed with various pages (`DashboardPage`, `HomePage`, `AlertsPage`, `TrackingPage`, `TrafficPage`).
- The backend is set up as a foundational layer to eventually integrate real AI models (YOLO, ANPR, Re-ID) and a database (PostgreSQL/PostGIS, Redis) instead of just serving mock data.
- The UI handles both direct local mock data and API data gracefully.

## Planned/Future Integrations
- Replacing mock data in the backend with live real-time inference (YOLO, OCR, Re-ID).
- Integrating WebSockets for real-time tracking and live alerts.
- Database integration for persistent trajectory history and origin-destination matrices.

## Development Workflow
When working on features:
1. Identify if it's a frontend UI change or a backend logic change.
2. If changing the backend, ensure the API structure matches what `api.js` expects on the frontend.
3. Keep mock data intact until a full DB/AI integration is in place, as it helps UI development without needing heavy inference setups.
