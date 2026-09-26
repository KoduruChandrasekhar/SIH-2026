import { Play, Pause, RotateCcw, Check } from "lucide-react";

// "09:14:08" / "09:14" → seconds of day (null when the label is not a clock time)
const clockSeconds = (t) => {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t ?? ""));
  return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0) : null;
};
const fmtClock = (s) => [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, Math.floor(s) % 60].map((v) => String(v).padStart(2, "0")).join(":");

/** Wall-clock time at a fractional position along the journey (interpolated between hop times). */
function timeAt(observations, pos) {
  const i = Math.min(Math.floor(pos), observations.length - 1);
  const a = clockSeconds(observations[i]?.time);
  const b = clockSeconds(observations[Math.min(i + 1, observations.length - 1)]?.time);
  if (a == null) return observations[i]?.time ?? "—";
  if (b == null || b < a) return fmtClock(a);
  return fmtClock(a + (b - a) * (pos - i));
}

/**
 * Journey timeline — one node per camera hop.
 * done: filled + check · active: highlighted ring · upcoming: hollow.
 * The fill follows the vehicle continuously (hop index + progress along the current leg);
 * legs listed in `deviationSegs` are tinted amber.
 * Historical playback: the scrubber below the nodes moves the vehicle anywhere along the stored
 * trajectory (hop index + fraction of the leg); Play resumes from there.
 */
export default function JourneyTimeline({
  observations,
  currentIndex,
  segmentProgress,
  isPlaying,
  isComplete,
  deviationSegs = [],
  onSeek,
  onPlay,
  onPause,
  onRestart,
  onScrub,
}) {
  const last = observations.length - 1;
  const progress = isComplete ? 1 : currentIndex < 0 ? 0 : Math.min(1, (currentIndex + segmentProgress) / Math.max(last, 1));
  const position = isComplete ? last : currentIndex < 0 ? 0 : Math.min(last, currentIndex + segmentProgress);
  const leg = Math.min(Math.floor(position), Math.max(last - 1, 0));

  return (
    <div className="fade-up delay-300 overflow-hidden rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="flex shrink-0 items-center gap-2 border-r border-gray-200 pr-4 sm:pr-6">
          {isComplete ? (
            <button onClick={onRestart} aria-label="Replay journey" className="tn-press flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100">
              <RotateCcw size={18} />
            </button>
          ) : isPlaying ? (
            <button onClick={onPause} aria-label="Pause journey" className="tn-press flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100">
              <Pause size={18} />
            </button>
          ) : (
            <button onClick={onPlay} aria-label="Play journey" className="tn-press flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700">
              <Play size={18} fill="currentColor" />
            </button>
          )}
          <div className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">
            Journey
            <br />
            Timeline
          </div>
        </div>

        <div className="relative flex-1 px-6 pb-8 pt-4">
          {/* Track with per-leg tint */}
          <div className="absolute left-[34px] right-[34px] top-[26px] flex h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-gray-100">
            {observations.slice(0, -1).map((o, i) => (
              <span key={o.camera + i} className="h-full flex-1" style={{ background: deviationSegs.includes(i) ? "rgba(245, 158, 11, 0.25)" : "transparent" }} />
            ))}
          </div>
          {/* Progress fill (transform only — cheap to animate) */}
          <div className="absolute left-[34px] right-[34px] top-[26px] h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
            <div
              className="h-full origin-left rounded-full bg-blue-600"
              style={{ transform: `scaleX(${progress})`, transition: isPlaying ? "none" : "transform 300ms ease" }}
            />
          </div>

          <ol className="relative flex justify-between">
            {observations.map((obs, idx) => {
              const done = isComplete || idx < currentIndex;
              const active = !isComplete && idx === currentIndex;
              return (
                <li key={obs.camera + idx} className="relative flex flex-col items-center">
                  <button
                    onClick={() => onSeek(idx)}
                    aria-label={`Jump to ${obs.camera.replace(" #", "-")} at ${obs.time}`}
                    aria-current={active ? "step" : undefined}
                    className={`relative z-10 flex h-5 w-5 items-center justify-center rounded-full transition-all duration-300 ${
                      active
                        ? "scale-110 bg-blue-600 shadow-[0_0_0_5px_rgba(37,99,235,0.22)]"
                        : done
                        ? "bg-blue-600"
                        : "border-2 border-gray-300 bg-white"
                    }`}
                  >
                    {done && <Check size={11} strokeWidth={3} className="text-white" />}
                    {active && <span className="tn-pulse tn-pulse--blue absolute inset-0 rounded-full" aria-hidden="true" />}
                  </button>
                  <div className="absolute left-1/2 top-7 flex w-20 -translate-x-1/2 flex-col items-center text-center sm:w-28">
                    <span className={`font-mono text-[10px] font-bold transition-colors ${done || active ? "text-blue-600" : "text-gray-400"}`}>
                      {obs.camera.replace(" #", "-")}
                    </span>
                    <span className="text-[9px] text-gray-500">{obs.time}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {onScrub && last > 0 && (
        <div className="mt-1 flex items-center gap-3 border-t border-gray-100 pt-3">
          <span className="w-[4.5rem] shrink-0 text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Playback</span>
          <input
            type="range"
            min={0}
            max={last}
            step={0.01}
            value={position}
            onChange={(e) => onScrub(parseFloat(e.target.value))}
            aria-label="Scrub through the recorded journey"
            aria-valuetext={`${timeAt(observations, position)}, ${observations[leg].camera.replace(" #", "-")} towards ${observations[Math.min(leg + 1, last)].camera.replace(" #", "-")}`}
            className="h-1.5 flex-1 cursor-pointer accent-blue-600"
          />
          <span className="shrink-0 text-right font-mono text-[10px] font-bold text-gray-600">
            {timeAt(observations, position)}
            <span className="ml-1.5 font-sans font-semibold text-gray-400">
              {observations[leg].camera.replace(" #", "-")} → {observations[Math.min(leg + 1, last)].camera.replace(" #", "-")}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
