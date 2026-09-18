import { Play, Pause, RotateCcw } from "lucide-react";

export default function JourneyTimeline({
  observations,
  currentIndex,
  segmentProgress,
  isPlaying,
  isComplete,
  onSeek,
  onPlay,
  onPause,
  onRestart
}) {
  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
      <div className="flex items-center gap-6">
        <div className="flex shrink-0 items-center gap-2 border-r border-gray-200 pr-6">
          {isComplete ? (
            <button onClick={onRestart} className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
              <RotateCcw size={18} />
            </button>
          ) : isPlaying ? (
            <button onClick={onPause} className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
              <Pause size={18} />
            </button>
          ) : (
            <button onClick={onPlay} className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors">
              <Play size={18} fill="currentColor" />
            </button>
          )}
          <div className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">
            Journey<br/>Timeline
          </div>
        </div>

        <div className="relative flex-1 py-4">
          {/* Background track */}
          <div className="absolute top-1/2 left-0 h-1.5 w-full -translate-y-1/2 rounded-full bg-gray-100"></div>
          
          {/* Progress fill */}
          <div 
            className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-blue-600 transition-all duration-300"
            style={{
              width: currentIndex >= 0 
                ? `${(Math.max(0, currentIndex) + segmentProgress) / (observations.length - 1) * 100}%` 
                : '0%'
            }}
          ></div>

          <div className="relative flex justify-between">
            {observations.map((obs, idx) => {
              const isVisited = idx <= currentIndex;
              const isActive = idx === currentIndex;
              return (
                <div key={obs.camera} className="flex flex-col items-center">
                  <button 
                    onClick={() => onSeek(idx)}
                    className={`relative z-10 flex h-4 w-4 items-center justify-center rounded-full transition-all duration-300 ${
                      isActive ? 'bg-blue-600 shadow-[0_0_0_4px_rgba(37,99,235,0.2)]' :
                      isVisited ? 'bg-blue-600' : 'bg-white border-2 border-gray-300'
                    }`}
                  >
                    {isActive && <span className="absolute h-full w-full rounded-full bg-blue-600 animate-ping opacity-75"></span>}
                  </button>
                  <div className="absolute top-6 flex w-24 -translate-x-1/2 flex-col items-center text-center">
                    <span className={`font-mono text-[10px] font-bold ${isVisited ? 'text-blue-600' : 'text-gray-400'}`}>{obs.camera}</span>
                    <span className="text-[9px] text-gray-500">{obs.time}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
