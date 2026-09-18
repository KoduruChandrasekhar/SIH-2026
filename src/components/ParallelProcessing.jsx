import { GitMerge, Check, Loader2 } from "lucide-react";

export default function ParallelProcessing({ isActive, identityProgress, macroProgress }) {
  if (!isActive) return null;

  const Node = ({ label, active, complete }) => (
    <div className={`relative flex items-center justify-center rounded-lg border px-3 py-1.5 text-[9px] font-bold transition-all duration-300 ${complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : active ? 'border-blue-300 bg-blue-600 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)] scale-105' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
      {complete && <Check size={10} className="mr-1" />}
      {active && !complete && <Loader2 size={10} className="mr-1 animate-spin" />}
      {label}
    </div>
  );

  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl mt-5">
      <div className="mb-4 flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[9px] font-extrabold uppercase tracking-widest text-blue-600">
          <GitMerge size={12} /> Parallel Processing Architecture
        </div>
      </div>

      <div className="flex flex-col items-center pb-2">
        <Node label="BYTETRACK / LOCAL TRACKING" complete={true} />
        <div className="my-1 h-4 w-px bg-gray-300" />
        
        <div className="flex w-full max-w-md justify-between">
          <div className="flex w-1/2 flex-col items-center border-r border-gray-200 pr-2">
            <span className="mb-3 text-[9px] font-extrabold uppercase text-gray-400">Identity Pipeline</span>
            <div className="space-y-3 w-full">
              <Node label="Plate OCR" active={identityProgress >= 1} complete={identityProgress > 1} />
              <Node label="Re-Identification" active={identityProgress >= 2} complete={identityProgress > 2} />
              <Node label="Global ID Assign" active={identityProgress >= 3} complete={identityProgress > 3} />
            </div>
          </div>
          
          <div className="flex w-1/2 flex-col items-center pl-2">
            <span className="mb-3 text-[9px] font-extrabold uppercase text-gray-400">Macro Pipeline</span>
            <div className="space-y-3 w-full">
              <Node label="Vehicle Count" active={macroProgress >= 1} complete={macroProgress > 1} />
              <Node label="Density/Speed" active={macroProgress >= 2} complete={macroProgress > 2} />
              <Node label="Flow Analytics" active={macroProgress >= 3} complete={macroProgress > 3} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
