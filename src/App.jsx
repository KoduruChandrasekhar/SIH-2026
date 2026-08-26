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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30 text-gray-900 font-sans antialiased selection:bg-blue-600 selection:text-white">
      <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        
        {/* Active Page Component */}
        {renderPage()}

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
    </div>
  );
}