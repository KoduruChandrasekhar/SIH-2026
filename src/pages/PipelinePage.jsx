import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import Navbar from "../components/layout/Navbar";
import PipelineFlow from "../components/anpr/PipelineFlow";
import OcrLab from "../components/anpr/OcrLab";
import AnprFunnel from "../components/anpr/AnprFunnel";
import { DetectorUpgrade, OcrUpgrade } from "../components/anpr/ModelBenchmarks";
import { fetchDbHealth } from "../lib/api";

/**
 * Module 06 — the AI pipeline behind every read: the backend's stages, one real OCR read step by step,
 * the ANPR funnel from saved (or live) runs, and the measured detector / OCR upgrades.
 */
export default function PipelinePage({ navigate, openModal }) {
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchDbHealth().then((h) => alive && setLive(Boolean(h)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="relative flex w-full flex-col gap-5 pb-10">
      <div className="w-full">
        <Navbar page="pipeline" navigate={navigate} openModal={openModal} />
      </div>

      <header className="premium-panel fade-up p-6">
        <span className="premium-badge text-xs font-extrabold uppercase tracking-[0.22em] text-emerald-600">
          <Cpu size={14} aria-hidden="true" />
          Module 06: AI pipeline
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">How TraceNet reads the city</h1>
        <p className="mt-1.5 max-w-3xl text-sm font-medium text-gray-500">
          Every stage between a camera frame and an officer's alert — with a real plate read from the pipeline, the funnel from
          raw detections to readable plates, and the measured detector and OCR upgrades.
        </p>
      </header>

      <PipelineFlow live={live} />
      <OcrLab />
      <div className="grid gap-5 lg:grid-cols-2">
        <AnprFunnel />
        <OcrUpgrade />
      </div>
      <DetectorUpgrade />
    </div>
  );
}
