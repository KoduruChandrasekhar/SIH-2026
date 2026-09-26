import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import CamerasPage from "./pages/CamerasPage";
import TrackingPage from "./pages/TrackingPage";
import TrafficPage from "./pages/TrafficPage";
import AlertsPage from "./pages/AlertsPage";
import PipelinePage from "./pages/PipelinePage";
import LoginPage from "./pages/LoginPage";
import AdminPage from "./pages/AdminPage";
import { X } from "lucide-react";
import { AlertsProvider } from "./context/AlertsContext";
import { ensureSession } from "./lib/auth";
import AmbientBackdrop from "./components/fx/AmbientBackdrop";
import CommandPalette from "./components/fx/CommandPalette";
import useInteractionFX from "./components/fx/useInteractionFX";

export default function App() {
  const [page, setPage] = useState("home");
  // Optional context carried between modules, e.g. { plate } → Tracking, { corridor } → Traffic,
  // { camera } → Cameras. Existing navigate("page") calls keep working unchanged.
  const [params, setParams] = useState(null);
  const navigate = useCallback((target, nextParams = null) => {
    const commit = () => {
      setParams(nextParams);
      setPage(target);
    };
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) {
      commit();
      return;
    }
    // Native view transition: the old page crossfades out, the navbar stays put and its active pill slides
    const root = document.documentElement;
    root.classList.add("tn-vt");
    const vt = document.startViewTransition(() => {
      flushSync(commit);
      window.scrollTo(0, 0);
    });
    vt.finished.finally(() => root.classList.remove("tn-vt"));
  }, []);
  const [modal, setModal] = useState({ isOpen: false, title: "", content: "" });

  const openModal = (title, content) => {
    setModal({ isOpen: true, title, content });
  };

  const closeModal = () => {
    setModal({ isOpen: false, title: "", content: "" });
  };

  // Cursor spotlight on cards, KPI tilt, button ripples
  useInteractionFX();

  // Phase 6: sign in as the demo officer on load (no login wall); the JWT is injected into API calls
  useEffect(() => {
    ensureSession();
  }, []);

  // Each page starts at the top (the homepage is a long scrolling page)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  // Renders the correct page component based on state
  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <DashboardPage navigate={navigate} openModal={openModal} params={params} />;
      case "cameras":
        return <CamerasPage navigate={navigate} openModal={openModal} params={params} />;
      case "tracking":
        return <TrackingPage navigate={navigate} openModal={openModal} params={params} />;
      case "traffic":
        return <TrafficPage navigate={navigate} openModal={openModal} params={params} />;
      case "pipeline":
        return <PipelinePage navigate={navigate} openModal={openModal} params={params} />;
      case "alerts":
        return <AlertsPage navigate={navigate} openModal={openModal} params={params} />;
      case "admin":
        return <AdminPage navigate={navigate} openModal={openModal} params={params} />;
      case "login":
        return <LoginPage navigate={navigate} openModal={openModal} params={params} />;
      case "home":
      default:
        return <HomePage navigate={navigate} openModal={openModal} params={params} />;
    }
  };

  return (
    <AlertsProvider onOpenAlerts={() => navigate("alerts")}>
    <div className="isolate min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30 text-gray-900 font-sans antialiased selection:bg-blue-600 selection:text-white">
      {/* Reading progress (pure CSS scroll-driven animation) */}
      <div className="tn-scroll-progress" aria-hidden="true" />
      {/* Module pages sit on the ambient backdrop; the homepage paints its own */}
      {page !== "home" && <AmbientBackdrop page={page} />}

      {/* The homepage renders full-bleed (cinematic hero); other pages keep the centered container */}
      {/* keyed wrapper → a short fade/rise on every module change (no full-screen loader) */}
      {page === "home" ? (
        <div key={page} className="tn-page-enter">{renderPage()}</div>
      ) : (
        <div key={page} className="tn-page-enter tn-inner mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          {renderPage()}
        </div>
      )}

      <CommandPalette navigate={navigate} page={page} />

      {/* Global Popup Modal Component */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black tracking-tight text-gray-900">
                {modal.title}
              </h3>
              <button
                onClick={closeModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition"
              >
                <X size={16} />
              </button>
            </div>
            <div className="text-xs font-medium leading-relaxed text-gray-600 whitespace-pre-line">
              {modal.content}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={closeModal}
                className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-gray-800 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AlertsProvider>
  );
}