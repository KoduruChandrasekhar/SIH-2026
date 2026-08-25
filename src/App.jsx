import { useState } from "react";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import Modal from "./components/Modal";
import Shell from "./components/Shell";


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
      {page === "home" ? (
        <HomePage navigate={navigate} openModal={openModal} />
      ) : (
        <DashboardPage navigate={navigate} openModal={openModal} initialArea={selectedArea} />
      )}
      <Modal modal={modal} close={() => setModal(null)} />
    </Shell>
  );
}