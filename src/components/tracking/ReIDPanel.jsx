import { useEffect, useState } from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { formatConfidence } from "../../data/demoData";

export default function ReIDPanel({ matchData, fromCamera, toCamera, globalId, isActive }) {
  const [progress, setProgress] = useState({
    plate: 0, appearance: 0, type: 0, color: 0, time: 0, route: 0
  });
  const [stage, setStage] = useState('idle');

  useEffect(() => {
    if (!isActive || !matchData) {
      setProgress({ plate: 0, appearance: 0, type: 0, color: 0, time: 0, route: 0 });
      setStage('idle');
      return;
    }

    setStage('calculating');
    
    const timers = [];
    const keys = ['plate', 'appearance', 'type', 'color', 'time', 'route'];
    const dataKeys = ['plateSimilarity', 'appearanceSimilarity', 'vehicleTypeMatch', 'vehicleColorMatch', 'timeFeasibility', 'routeFeasibility'];
    
    keys.forEach((key, i) => {
      timers.push(setTimeout(() => {
        setProgress(prev => ({ ...prev, [key]: matchData[dataKeys[i]] }));
      }, 500 + (i * 200)));
    });

    timers.push(setTimeout(() => setStage('confirmed'), 500 + (keys.length * 200) + 500));

    return () => timers.forEach(clearTimeout);
  }, [isActive, matchData]);

  if (!isActive || !matchData) return null;

  const Metric = ({ label, value }) => (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[9px] font-extrabold uppercase text-gray-500">
        <span>{label}</span>
        <span>{value > 0 ? formatConfidence(value) : '---'}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div 
          className="h-full rounded-full bg-blue-600 transition-all duration-700 ease-out"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint size={14} className="text-blue-600" />
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Re-Identification</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-extrabold">
          {stage === 'calculating' ? (
            <><span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" /> <span className="text-amber-600">MATCHING</span></>
          ) : stage === 'confirmed' ? (
            <><ShieldCheck size={12} className="text-emerald-500" /> <span className="text-emerald-600">CONFIRMED</span></>
          ) : null}
        </div>
      </div>

      <div className="mb-3 text-[10px] font-bold text-gray-500 text-center">
        {fromCamera} <span className="mx-2 text-gray-300">→</span> {toCamera}
      </div>

      <div className="space-y-1">
        <Metric label="Plate Similarity" value={progress.plate} />
        <Metric label="Visual Appearance" value={progress.appearance} />
        <Metric label="Vehicle Type" value={progress.type} />
        <Metric label="Color Match" value={progress.color} />
        <Metric label="Time Feasibility" value={progress.time} />
        <Metric label="Route Feasibility" value={progress.route} />
      </div>

      <div className={`mt-4 rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-center transition-all duration-500 ${stage === 'confirmed' ? 'border-blue-200 bg-blue-50/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'opacity-50'}`}>
        <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-500">Overall Match</span>
        <div className="text-xl font-black text-blue-600">
          {stage === 'confirmed' ? formatConfidence(matchData.overallConfidence) : '...'}
        </div>
        <div className="mt-1 font-mono text-[10px] font-bold text-gray-500">Global ID: {globalId}</div>
      </div>
    </div>
  );
}
