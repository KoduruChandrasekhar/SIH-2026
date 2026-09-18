import { useState } from "react";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import TrackingPage from "./pages/TrackingPage";
import TrafficPage from "./pages/TrafficPage";
import AlertsPage from "./pages/AlertsPage";
import LoginPage from "./pages/LoginPage";
import { X } from "lucide-react";

export default function App() {
  const [page, setPage] = useState("home");
  const [modal, setModal] = useState({ isOpen: false, title: "", content: "" });

  const openModal = (title, content) => {
    setModal({ isOpen: true, title, content });
  };

  const closeModal = () => {
    setModal({ isOpen: false, title: "", content: "" });
  };

  // Renders the correct page component based on state
  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <DashboardPage navigate={setPage} openModal={openModal} />;
      case "tracking":
        return <TrackingPage navigate={setPage} openModal={openModal} />;
      case "traffic":
        return <TrafficPage navigate={setPage} openModal={openModal} />;
      case "alerts":
        return <AlertsPage navigate={setPage} openModal={openModal} />;
      case "login":
        return <LoginPage navigate={setPage} openModal={openModal} />;
      case "home":
      default:
        return <HomePage navigate={setPage} openModal={openModal} />;
    }
  };

  // HomePage handles its own full-bleed layout; other pages get container padding
  const isHome = page === "home";

  return (
    <div className="min-h-screen bg-[var(--bg-void)] text-[var(--text-primary)] font-sans antialiased selection:bg-blue-600 selection:text-white">
      {isHome ? (
        renderPage()
      ) : (
        <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          {renderPage()}
        </div>
      )}

      {/* Global Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black tracking-tight text-[var(--text-primary)]">
                {modal.title}
              </h3>
              <button
                onClick={closeModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-glass)] text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)] transition"
              >
                <X size={16} />
              </button>
            </div>
            <div className="text-xs font-medium leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
              {modal.content}
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={closeModal} className="btn-primary text-xs px-4 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}