import { useEffect, useState } from "react";
import { Scan, CheckCircle2, Workflow } from "lucide-react";
import { formatConfidence } from "../demoData";

export default function OCRPanel({ ocrData, isActive }) {
  const [showSelected, setShowSelected] = useState(false);
  const [showConsensus, setShowConsensus] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setShowSelected(false);
      setShowConsensus(false);
      return;
    }
    
    const t1 = setTimeout(() => setShowSelected(true), 1000);
    const t2 = setTimeout(() => setShowConsensus(true), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isActive]);

  if (!isActive || !ocrData) return null;

  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl mt-4">
      <div className="mb-4 flex items-center gap-2">
        <Scan size={14} className="text-blue-600" />
        <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">OCR Evidence & Multi-Frame Consensus</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ocrData.candidateFrames.slice(0,3).map((frame, i) => (
          <div key={i} className={`relative overflow-hidden rounded-lg border bg-gray-900 p-2 text-white transition-all duration-500 ${showSelected && frame.selected ? 'border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'border-gray-800 opacity-60'}`}>
            <div className="mb-2 h-8 w-full bg-gray-800 rounded flex items-center justify-center font-mono text-xs tracking-widest border border-gray-700">
              {frame.ocrOutput}
            </div>
            <div className="text-[8px] text-gray-400 flex justify-between">
              <span>{frame.camera}</span>
              <span className={showSelected && frame.selected ? 'text-blue-400 font-bold' : ''}>{formatConfidence(frame.ocrConfidence)}</span>
            </div>
            {showSelected && frame.selected && (
              <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px] font-bold">✓</div>
            )}
          </div>
        ))}
      </div>

      <div className={`mt-4 overflow-hidden rounded-xl bg-emerald-50/70 border border-emerald-100 p-3 transition-all duration-500 ${showConsensus ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 py-0 mt-0'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <div>
              <div className="text-[9px] font-extrabold uppercase text-emerald-600">Final Validation</div>
              <div className="font-mono text-sm font-black">{ocrData.consensusPlate}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-black text-emerald-600">{formatConfidence(ocrData.consensusConfidence)}</div>
            <div className="text-[8px] font-bold text-gray-500">MULTI-FRAME CONSENSUS</div>
          </div>
        </div>
      </div>
    </div>
  );
}
