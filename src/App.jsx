import { useState } from "react";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import TrackingPage from "./pages/TrackingPage";
import Modal from "./components/Modal";
import Shell from "./components/Shell";
import TrafficPage from "./pages/TrafficPage";
import AlertsPage from "./pages/AlertsPage";

export default function App() {
  const [page, setPage] = useState("home");
  const [modal, setModal] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);

  const navigate = (target, area = null) => {
    setSelectedArea(area);
    setPage(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openModal = (title, text) => setModal({ title, text });

  return (
    <Shell>
      {page === "home" && <HomePage navigate={navigate} openModal={openModal} page={page} />}
      {page === "dashboard" && (
        <DashboardPage navigate={navigate} openModal={openModal} initialArea={selectedArea} page={page} />
      )}
      {page === "tracking" && (
        <TrackingPage navigate={navigate} openModal={openModal} page={page} />
      )}
      {page === "traffic" && <TrafficPage navigate={navigate} openModal={openModal} />}
      {page === "alerts" && <AlertsPage navigate={navigate} openModal={openModal} />}
      <Modal modal={modal} close={() => setModal(null)} />
    </Shell>
  );
}