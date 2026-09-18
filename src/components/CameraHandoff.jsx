import { Network, Search, CheckCircle2, ArrowRight } from "lucide-react";

export default function CameraHandoff({ fromCamera, candidates, confirmedCamera, isActive, stage }) {
  if (!isActive) return null;

  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl mt-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-blue-600" />
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Network Handoff</span>
        </div>
        <div className="flex items-center gap-1 text-[9px] font-extrabold text-blue-600 uppercase">
          {stage === 'leaving' && <span className="animate-pulse">LEAVING {fromCamera}</span>}
          {stage === 'searching' && <><Search size={10} className="animate-spin" /> SEARCHING...</>}
          {stage === 'found' && <span>CANDIDATE FOUND</span>}
          {stage === 'confirmed' && <span className="text-emerald-600">HANDOFF CONFIRMED</span>}
        </div>
      </div>

      <div className="space-y-2">
        {candidates.map((cand, i) => {
          const isTarget = cand.camera === confirmedCamera;
          const showHighlight = (stage === 'found' || stage === 'confirmed') && isTarget;
          const progress = stage === 'leaving' ? 0 : cand.match;
          
          return (
            <div key={cand.camera} className={`flex items-center justify-between rounded-xl border p-2.5 transition-all duration-300 ${showHighlight ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-gray-50/50'}`}>
              <div className="flex-1">
                <div className="flex justify-between text-[10px] font-bold mb-1">
                  <span className={showHighlight ? 'text-blue-700' : 'text-gray-600'}>{cand.camera}</span>
                  <span className={showHighlight ? 'text-blue-700' : 'text-gray-500'}>{progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div 
                    className={`h-full rounded-full transition-all duration-700 ${showHighlight ? 'bg-blue-600' : 'bg-gray-400'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <div className="ml-3 w-4 flex justify-center">
                {showHighlight && stage === 'confirmed' && <CheckCircle2 size={14} className="text-blue-600" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
