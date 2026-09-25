import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert, Zap, X } from "lucide-react";
import { WS_BASE } from "../api";
import { ensureSession, getToken, onSessionChange, refreshSession } from "../auth";

/**
 * Phase 6 — live alert stream for the whole app.
 *
 * Opens ws://…/ws/alerts?token=<JWT> (browsers cannot send an Authorization header on a WebSocket
 * handshake), receives the recent-alert snapshot and then live CLONED_PLATE / BLACKLIST_HIT /
 * INVALID_FORMAT alerts, keeps them for the Alerts table, counts unread ones for the navbar bell,
 * and shows a toast (top right) on every page. Reconnects with backoff.
 */

const AlertsContext = createContext({ connected: false, live: false, alerts: [], unread: 0, markRead: () => {}, subscribe: () => () => {} });
export const useAlerts = () => useContext(AlertsContext);

const MAX_ALERTS = 200;
const TOAST_MS = 7000;

export function AlertsProvider({ children, onOpenAlerts }) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false); // a real backend session exists (snapshot received)
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const subscribers = useRef(new Set());

  const pushToast = useCallback((row) => {
    setToasts((prev) => [row, ...prev.filter((t) => t.alertId !== row.alertId)].slice(0, 3));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.alertId !== row.alertId)), TOAST_MS);
  }, []);

  useEffect(() => {
    let ws = null;
    let retry = 0;
    let timer = null;
    let stopped = false;

    const connect = async () => {
      const session = await ensureSession();
      if (stopped) return;
      if (!session || session.role !== "law_enforcement") {
        timer = setTimeout(connect, 5000); // backend offline, or an admin session (no alert feed)
        return;
      }
      ws = new WebSocket(`${WS_BASE}/ws/alerts?token=${encodeURIComponent(getToken())}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.event === "hello") {
          setLive(true);
          setAlerts((prev) => {
            const known = new Set(prev.map((a) => a.alertId));
            return [...prev, ...msg.recent.map((m) => ({ ...m.ui, isNew: false })).filter((a) => !known.has(a.alertId))].slice(0, MAX_ALERTS);
          });
        } else if (msg.event === "alert") {
          const row = msg.ui;
          setAlerts((prev) => [row, ...prev.filter((a) => a.alertId !== row.alertId)].slice(0, MAX_ALERTS));
          setUnread((n) => n + 1);
          pushToast(row);
          subscribers.current.forEach((fn) => fn(row, msg));
        }
      };
      ws.onclose = async (event) => {
        setConnected(false);
        if (stopped) return;
        // 4401: token rejected (e.g. backend restarted with a new secret) → re-login before reconnecting
        if (event.code === 4401) await refreshSession();
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 1000 * 2 ** (retry - 1));
      };
    };

    connect();
    const unsubscribe = onSessionChange(() => {
      if (ws && ws.readyState <= 1) ws.close();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      if (ws && ws.readyState <= 1) ws.close();
    };
  }, [pushToast]);

  const markRead = useCallback(() => setUnread(0), []);
  const subscribe = useCallback((fn) => {
    subscribers.current.add(fn);
    return () => subscribers.current.delete(fn);
  }, []);
  const value = useMemo(() => ({ connected, live, alerts, unread, markRead, subscribe }), [connected, live, alerts, unread, markRead, subscribe]);

  return (
    <AlertsContext.Provider value={value}>
      {children}
      {/* Live alert toasts — same visual language as the Alerts page toast */}
      <div className="pointer-events-none fixed right-6 top-6 z-[70] flex w-[min(380px,calc(100vw-3rem))] flex-col gap-2" aria-live="assertive">
        {toasts.map((t) => (
          <div
            key={t.alertId}
            role="alert"
            className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-red-500/40 bg-gray-950/95 px-4 py-3 text-xs text-white shadow-2xl backdrop-blur-xl animate-fade-in"
          >
            {t.alertType === "BLACKLIST_HIT" ? <ShieldAlert size={18} className="mt-0.5 shrink-0 text-red-400" /> : <Zap size={18} className="mt-0.5 shrink-0 text-amber-400" />}
            <button type="button" onClick={() => onOpenAlerts?.(t)} className="min-w-0 flex-1 text-left">
              <p className="font-black uppercase tracking-wider text-red-300">
                {t.severity} · {t.category}
              </p>
              <p className="mt-0.5 font-mono text-sm font-black">{t.plateNumber}</p>
              <p className="mt-0.5 truncate font-semibold text-gray-300">
                {t.cameraNode} · {t.timestamp} · {t.confidence}
              </p>
            </button>
            <button type="button" aria-label="Dismiss alert" onClick={() => setToasts((prev) => prev.filter((x) => x.alertId !== t.alertId))} className="text-gray-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </AlertsContext.Provider>
  );
}
