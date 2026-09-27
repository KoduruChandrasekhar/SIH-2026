<div align="center">

# TraceNet

### One city. Every camera. One connected picture of how traffic moves.

TraceNet turns a city's scattered traffic cameras into a single, connected intelligence network —
so a vehicle seen at one junction is understood in the context of every other junction,
and the people who keep a city moving can see, understand and act on what is happening, as it happens.

</div>

---

## Contents

- [The problem](#the-problem)
- [Why it matters](#why-it-matters)
- [Our vision](#our-vision)
- [What TraceNet does](#what-tracenet-does)
- [A tour of the platform](#a-tour-of-the-platform)
- [Who it is for](#who-it-is-for)
- [Design principles](#design-principles)
- [Privacy and responsible use](#privacy-and-responsible-use)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Roadmap](#roadmap)
- [Project status](#project-status)

---

## The problem

Modern cities are watched by thousands of traffic and surveillance cameras. Yet most of them work **alone**.

Each camera records what passes in front of it and little else. It does not know that the car it just saw was
seen two kilometres away four minutes earlier, or that the queue building at its junction is spilling over from
the next one. The footage exists — the *connections* between it do not.

That gap shows up everywhere:

| Where it hurts | What it looks like today |
| --- | --- |
| **Following a vehicle** | Reconstructing where one vehicle went means someone watching hours of footage, camera by camera, stitching the journey together by hand. |
| **Understanding traffic** | Each junction reports its own numbers. Nobody sees how congestion forms, spreads and clears across the city as one system. |
| **Responding to incidents** | A flagged vehicle is only noticed if the right person happens to be watching the right screen at the right moment. |
| **Planning the city** | Decisions about signals, lanes and routes are made from sampled counts and surveys instead of how people actually move. |
| **Coordinating teams** | Traffic control, enforcement and planning each look at different screens, different data and different versions of the truth. |

The cameras are already in place. What is missing is the layer that **connects them**.

---

## Why it matters

When camera observations are connected, questions that once took days become answerable in seconds:

- *Where did this vehicle come from, and where is it heading next?*
- *Which junctions are choking right now — and which ones will be next?*
- *Where do the morning's trips actually start and end?*
- *Which cameras are down, and what are we missing because of it?*

Faster answers mean shorter response times, better-timed interventions, fewer blind spots and a city that plans
around evidence rather than estimates.

---

## Our vision

TraceNet is built around three simple ideas.

**1. Think in networks, not cameras.**
Every camera is a node in a city-wide network. Observations only become meaningful when they are placed next to
what the neighbouring cameras saw.

**2. Think in journeys, not snapshots.**
A single sighting is a data point. A sequence of sightings across the city is a *journey* — and journeys are what
investigators, planners and traffic controllers actually care about.

**3. Put everything on one map, in real time.**
Vehicles, congestion, incidents and alerts belong on the same live map, shared by everyone who needs it — not
spread across separate tools.

---

## What TraceNet does

| Capability | What it gives you |
| --- | --- |
| **Connected camera network** | Every camera in the city on one live map, with its health and activity at a glance. |
| **Vehicle journeys** | The path a vehicle took across multiple cameras, reconstructed and shown as a single journey on the map. |
| **City-wide traffic picture** | Congestion, speed and flow across every monitored junction and corridor, updated continuously. |
| **Live road conditions** | Current road speeds and incidents across the city, blended with the camera network's own view. |
| **Movement patterns** | Where trips begin and end, which routes carry the most traffic, and how that changes over the day. |
| **Real-time alerts** | Watchlisted vehicles, unusual movement and congestion build-ups surfaced the moment they happen. |
| **One shared view** | Control rooms, field teams and planners working from the same map and the same numbers. |

---

## A tour of the platform

TraceNet is a web application organised into focused modules. Each one answers a different kind of question.

### 🏠 Home — the network at a glance
An introduction to the platform: a live, animated view of the camera network, a guided story of a single vehicle
journey across the city, and an interactive city map whose layers change as you explore — the whole network,
a tracked journey, traffic flows and active alerts.

### 📊 Dashboard — the command overview
The control-room view. Network-wide speed, congestion and delay, active incidents and alerts, a live map of
junctions coloured by current conditions, and trends through the day. Select any junction to focus on it.

### 🎥 Cameras — the camera wall
Every camera in the network with its status, activity and latest reading. Hover a tile to preview its feed,
open it for details, and see at a glance which cameras are live, degraded or offline.

### 🧭 Tracking — follow a journey
Search for a vehicle and see its journey across the city: every camera it passed, when, and in what order,
laid out on a map and a timeline — including how each sighting was linked to the next.

### 🚦 Traffic — the city's pulse
A city-wide traffic view: every corridor with its current speed and congestion, a live heat view across all
junctions, live road conditions and incidents, busiest corridors, trends through the day, and the movement
between different parts of the city.

### ⚙️ How it works — from a camera frame to an insight
A visual, step-by-step walkthrough of how the platform turns what a camera sees into something an operator can
act on, illustrated with recorded street footage.

### 🚨 Alerts — know first
A single feed of everything that needs attention, prioritised by severity, with each alert placed on the map
next to the cameras around it.

### 🔐 Administration
User roles and access, camera management and system health for the people who run the platform.

---

## Who it is for

- **Traffic control rooms** — see congestion form and respond before it spreads.
- **Law enforcement** — follow a flagged vehicle across the city in moments, not hours.
- **City and transport planners** — design signals, lanes and routes around real movement patterns.
- **Emergency services** — understand road conditions along a route before committing to it.
- **Operations teams** — keep the camera network healthy and know immediately when a camera goes dark.

---

## Design principles

- **Clarity first.** Every screen answers one question well. Colour always means the same thing:
  green is flowing, yellow is building, orange is heavy and red is severe.
- **Live by default.** Numbers update continuously; timestamps show exactly how fresh they are.
- **One source of truth.** Every page reads from the same network, so the dashboard, the map and the camera wall
  always agree.
- **Graceful everywhere.** The platform works as a self-contained demo when no live services are connected, and
  switches to live data automatically when they are.
- **Built for control rooms and phones alike.** Responsive layouts, light and dark themes, keyboard navigation
  and reduced-motion support throughout.

---

## Privacy and responsible use

A system that can follow vehicles across a city must be built with restraint. TraceNet is designed on these
principles:

- **Purpose-bound.** Built for traffic management, public safety and planning — not for general surveillance.
- **Role-based access.** People see only what their role requires; sensitive views sit behind authentication.
- **Accountability.** Access to vehicle journeys is meant to be logged and auditable.
- **Minimal retention.** Keep what is needed for the task, for as long as it is needed, and no longer.
- **Aggregate where possible.** City-wide traffic insight does not need to identify anyone.

Any real-world deployment must follow the data-protection laws and policies of the jurisdiction it operates in.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- npm (bundled with Node.js)

### Run it locally

```bash
git clone <repository-url>
cd TraceNet
npm install
npm run dev
```

Then open the address printed in the terminal (usually `http://localhost:5173`).

### Optional configuration

The web app runs out of the box on built-in demo data. Optional settings — such as connecting live services —
live in `.env.example`. To use them, copy it to `.env.local` and fill in the values you need:

```bash
cp .env.example .env.local
```

### Build for production

```bash
npm run build     # outputs a static site to dist/
npm run preview   # serves the production build locally
```

The production build is a static site and can be hosted on any static host or CDN. A ready-made configuration
for [Vercel](https://vercel.com/) is included (`vercel.json`).

### Available scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Create an optimised production build in `dist/` |
| `npm run preview` | Serve the production build locally |

---

## Project layout

```text
TraceNet/
├── index.html              App entry page
├── public/                 Static media (videos, images, icons)
├── src/
│   ├── main.jsx            App bootstrap
│   ├── App.jsx             Page switching and app shell
│   ├── pages/              One file per module (Home, Dashboard, Cameras, Tracking, Traffic, …)
│   ├── components/
│   │   ├── layout/         Navigation, command palette, page backdrop
│   │   ├── ui/             Shared building blocks (charts, animated numbers)
│   │   ├── home/           Home page sections
│   │   ├── map/            Map layers
│   │   ├── camera/         Camera tiles
│   │   ├── tracking/       Journey views
│   │   ├── traffic/        Live traffic panels
│   │   ├── pipeline/       "How it works" sections
│   │   └── anpr/           Plate-read evidence panel
│   ├── context/            App-wide state (theme, alerts)
│   ├── hooks/              Reusable React hooks
│   ├── lib/                Services and utilities
│   ├── data/               Demo network and reference data
│   ├── styles/             Global styles and design tokens
│   └── assets/             Logo and bundled images
├── backend/                Server-side services
├── vite.config.js          Build configuration
└── vercel.json             Hosting configuration
```

---

## Roadmap

- **Wider coverage** — bring more of the city's cameras and junctions onto the network.
- **Smarter journeys** — link sightings more reliably in dense traffic, at night and in bad weather.
- **Predictive traffic** — forecast where congestion will form in the next 15–60 minutes, not just where it is now.
- **Signal coordination** — feed live insight back into traffic-signal timing.
- **Incident playbooks** — guided, step-by-step responses when an alert fires.
- **Mobile field app** — the same live picture for officers and crews on the ground.
- **Open reporting** — anonymised, aggregate traffic insight for city planners and the public.

---

## Project status

TraceNet is under active development. Unless connected to live services, the web app runs on **built-in demo
data**: camera readings, journeys, alerts and statistics shown in demo mode are illustrative and do not describe
real people, vehicles or incidents.

---

<div align="center">

**TraceNet** — *Track · Analyze · Connect*

</div>
