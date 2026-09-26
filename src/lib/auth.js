/**
 * TraceNet Phase 6 — JWT session.
 *
 * The app signs in automatically as the demo `officer` (law_enforcement) so it never stops at a
 * login wall; the Login page can switch identity (officer / admin). The token lives in memory +
 * sessionStorage and is injected into every API call by src/lib/api.js. A 401 triggers one re-login.
 */

import { API_BASE, BACKEND_ENABLED, DEMO_AUTO_LOGIN } from "./config";

const STORE_KEY = "tracenet.session";
// Demo identity provider (backend/api/auth.py). Not a secret: documented demo accounts.
const DEMO_OFFICER = { username: "officer", password: "police123" };

let session = null; // { token, username, role, name, exp }
let pending = null;
const listeners = new Set();

try {
  const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
  if (saved?.token && saved.exp > Date.now() / 1000 + 60) session = saved;
} catch {
  /* storage unavailable (private mode) — keep the session in memory only */
}

function setSession(next) {
  session = next;
  try {
    if (next) sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(session));
}

export const getSession = () => session;
export const getToken = () => session?.token ?? null;

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** POST /api/v1/auth/login. Returns the session, or throws Error(message). */
export async function login(username, password) {
  if (!BACKEND_ENABLED) throw new Error("No backend is connected — this deployment runs on the demo dataset");
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Invalid username or password" : `Login failed (${res.status})`);
  const data = await res.json();
  const next = { token: data.access_token, username: data.username, role: data.role, name: data.name, exp: Date.now() / 1000 + data.expires_in };
  setSession(next);
  return next;
}

/** Ensure a valid session, signing in as the demo officer if needed. Null when the backend is offline. */
export async function ensureSession() {
  if (session && session.exp > Date.now() / 1000 + 60) return session;
  if (!BACKEND_ENABLED || !DEMO_AUTO_LOGIN) return null;
  if (!pending) {
    pending = login(DEMO_OFFICER.username, DEMO_OFFICER.password)
      .catch(() => null)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Force a fresh officer login (after a 401, e.g. the backend restarted with a new JWT secret). */
export async function refreshSession() {
  const role = session?.role;
  setSession(null);
  // an admin session is not silently turned into an officer session
  return role && role !== "law_enforcement" ? null : ensureSession();
}
