import { Zap, Camera, Clock, Activity, MapPin, Gauge } from "lucide-react";
import { formatConfidence } from "../demoData";

export default function VehicleIdentityCard({ vehicle, currentObservation, isTracking }) {
  if (!vehicle) return null;

  return (
    <div className={`relative overflow-hidden rounded-[24px] border bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl transition-all duration-300 ${isTracking ? 'border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.15)]' : 'border-white/80'}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-blue-600" />
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Global Vehicle</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-extrabold text-blue-600">
          <span className={`h-1.5 w-1.5 rounded-full bg-blue-600 ${isTracking ? 'trace-live-dot' : ''}`} />
          {isTracking ? 'TRACKING ACTIVE' : 'IDLE'}
        </div>
      </div>
      
      <h2 className="text-2xl font-black font-mono text-blue-600">{vehicle.globalId}</h2>
      
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
        <div>
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Plate Number</span>
          <p className="font-mono text-sm font-black">{vehicle.plate}</p>
        </div>
        <div>
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Type / Color</span>
          <p className="text-sm font-black">{vehicle.vehicleType} • {vehicle.vehicleColor}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-gray-50/70 p-4 border border-gray-100">
        <div className="mb-3 flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-gray-500">
          <Activity size={12} /> Current Observation
        </div>
        
        {currentObservation ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[9px] font-extrabold uppercase text-gray-400">Camera</span>
                <p className="font-mono text-xs font-bold text-blue-600">{currentObservation.camera}</p>
                <p className="text-[10px] text-gray-600">{currentObservation.name}</p>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-extrabold uppercase text-gray-400">Timestamp</span>
                <p className="font-mono text-xs font-bold">{currentObservation.time}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-2 border-t border-gray-200/50 pt-2">
              <div>
                <span className="text-[9px] font-extrabold uppercase text-gray-400">Speed</span>
                <p className="text-[10px] font-bold">{currentObservation.speedLabel}</p>
              </div>
              <div>
                <span className="text-[9px] font-extrabold uppercase text-gray-400">Direction</span>
                <p className="text-[10px] font-bold">{currentObservation.direction}</p>
              </div>
              <div>
                <span className="text-[9px] font-extrabold uppercase text-gray-400">Match</span>
                <p className="text-[10px] font-bold text-emerald-600">{formatConfidence(currentObservation.confidence)}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-4 text-[10px] font-bold text-gray-400">
            Awaiting observation data...
          </div>
        )}
      </div>
    </div>
  );
}
