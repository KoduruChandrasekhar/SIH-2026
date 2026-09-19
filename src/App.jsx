import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Radio, X } from "lucide-react";
import HomePage from "./pages/HomePage";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const TrackingPage = lazy(() => import("./pages/TrackingPage"));
const TrafficPage = lazy(() => import("./pages/TrafficPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

function CommandLoading() {
  return <div className="command-loading"><span className="live-dot" /> Loading command surface</div>;
}

export default function App() {
  const [page, setPage] = useState("home");
  const [modal, setModal] = useState({ isOpen: false, title: "", content: "" });
  const [trackingLaunch, setTrackingLaunch] = useState(false);
  const [travelling, setTravelling] = useState(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  const queue = (fn, delay) => { timers.current.push(window.setTimeout(fn, delay)); };
  const navigate = useCallback((target) => {
    setTrackingLaunch(false);
    setPage(target);
  }, []);
  const launchTracking = useCallback(() => {
    if (travelling) return;
    setTravelling(true);
    setTrackingLaunch(true);
    queue(() => setPage("tracking"), 680);
    queue(() => setTravelling(false), 1650);
  }, [travelling]);
  const completeTrackingLaunch = useCallback(() => setTrackingLaunch(false), []);
  const openModal = (title, content) => setModal({ isOpen: true, title, content });
  const closeModal = () => setModal({ isOpen: false, title: "", content: "" });

  const content = (() => {
    switch (page) {
      case "dashboard": return <DashboardPage navigate={navigate} openModal={openModal} />;
      case "tracking": return <TrackingPage navigate={navigate} openModal={openModal} cinematicEntry={trackingLaunch} onCinematicComplete={completeTrackingLaunch} />;
      case "traffic": return <TrafficPage navigate={navigate} openModal={openModal} />;
      case "alerts": return <AlertsPage navigate={navigate} openModal={openModal} />;
      case "login": return <LoginPage navigate={navigate} openModal={openModal} />;
      default: return <HomePage navigate={navigate} openModal={openModal} launchTracking={launchTracking} />;
    }
  })();

  return (
    <div className="app-shell">
      <AnimatePresence mode="wait">
        <motion.div key={page} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.28, ease: "easeOut" }}>
          <Suspense fallback={<CommandLoading />}>{page === "home" ? content : <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">{content}</div>}</Suspense>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {travelling && <motion.div className="india-transition" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          <div className="india-transition-grid" /><div className="india-transition-ring ring-one" /><div className="india-transition-ring ring-two" />
          <div className="india-transition-core"><Crosshair size={26} /><strong>INDIA</strong><span>LOCKING HYDERABAD GRID</span></div>
          <div className="india-transition-status"><Radio size={14} /> Establishing live camera context</div>
        </motion.div>}
      </AnimatePresence>

      {modal.isOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border-accent)] bg-[rgba(10,14,26,0.96)] p-6 shadow-[0_24px_80px_rgba(0,0,0,.55)]">
          <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-[var(--text-primary)]">{modal.title}</h3><button onClick={closeModal} className="modal-close"><X size={16} /></button></div>
          <p className="whitespace-pre-line text-sm leading-6 text-[var(--text-secondary)]">{modal.content}</p>
          <div className="mt-6 flex justify-end"><button onClick={closeModal} className="btn-primary px-4 py-2 text-xs">Close</button></div>
        </div>
      </div>}
    </div>
  );
}
