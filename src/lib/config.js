/**
 * Deployment configuration (Vite env vars, baked in at build time — see .env.example).
 *
 * Development talks to the local FastAPI server. A production build (e.g. Vercel) talks to
 * VITE_API_BASE_URL; when that is unset it runs as a self-contained demo on the bundled dataset and
 * makes no backend requests at all (so visitors never hit a mixed-content block or a localhost prompt).
 */

const configured = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

export const API_BASE = (configured || (import.meta.env.DEV ? "http://localhost:8000" : "")).replace(/\/+$/, "");

/** False when the build has no backend: every API helper then resolves to its offline fallback. */
export const BACKEND_ENABLED = API_BASE !== "";

export const WS_BASE = API_BASE.replace(/^http/, "ws");

/** Sign in automatically as the demo officer. Set VITE_DEMO_AUTO_LOGIN=false to require the Login page. */
export const DEMO_AUTO_LOGIN = import.meta.env.VITE_DEMO_AUTO_LOGIN !== "false";

/** TomTom API key for the real-time traffic flow overlay (free tier). Empty = the Live traffic toggle is disabled. */
export const TOMTOM_API_KEY = (import.meta.env.VITE_TOMTOM_API_KEY ?? "").trim();

/** Google Maps JavaScript API key for the live traffic map (Google's own traffic layer). Takes priority over TomTom. */
export const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
