import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, VideoOff } from "lucide-react";
import { OCR_ACCURACY_TARGET } from "../data";

/**
 * CameraFeedCard — a simulated AI-powered CCTV camera feed card.
 *
 * Default: dark placeholder with camera info.
 * Hover:   looping MP4 with AI-style overlays (bounding boxes, track IDs, plate read).
 * Offline: "no signal" tile — no video, counters frozen at the last-seen time.
 * `alwaysPlay` keeps the feed running (used for the enlarged detail view).
 *
 * All overlays are simulated UI — no real YOLO/OCR runs in the browser.
 * Accepts registry cameras (src/data.js cameraRegistry) or the legacy `cameras` shape.
 */

const TRACK_DATA = [
  { tracks: ["TRACK-017", "TRACK-024"] },
  { tracks: ["TRACK-031", "TRACK-009"] },
  { tracks: ["TRACK-042", "TRACK-018"] },
  { tracks: ["TRACK-005", "TRACK-053"] },
];

const STATUS_LABEL = { online: "Live", degraded: "Degraded", offline: "Offline" };

export default function CameraFeedCard({ camera, index = 0, onSelect, selected = false, alwaysPlay = false, compact = false }) {
  const [isHovered, setIsHovered] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef(null);

  const status = String(camera.status || "online").toLowerCase();
  const offline = status === "offline" || !camera.videoFeed;
  const trackData = TRACK_DATA[index % TRACK_DATA.length];
  const camId = camera.code || camera.id.replace(" #", "-");
  const location = camera.name || camera.location;
  const plate = camera.lastPlate || camera.lastPlateRead;
  const ocr = camera.ocrRate;

  const showVideo = !offline && !videoFailed && (alwaysPlay || isHovered);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (showVideo) {
      v.play().catch((err) => {
        if (err.name !== "AbortError") setVideoFailed(true);
      });
    } else {
      v.pause();
      if (!alwaysPlay) v.currentTime = 0;
    }
  }, [showVideo, alwaysPlay]);

  const handleVideoError = useCallback(() => setVideoFailed(true), []);

  const Tag = onSelect ? "button" : "div";

  return (
    <Tag
      type={onSelect ? "button" : undefined}
      onClick={onSelect ? () => onSelect(camera) : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      aria-label={onSelect ? `${camId} ${location} — ${STATUS_LABEL[status] ?? status}. Open camera details` : undefined}
      className={`cam-feed-card group relative block w-full overflow-hidden rounded-[20px] border border-gray-200/80 text-left shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] ${selected ? "is-selected" : ""}`}
    >
      {/* Viewport — fixed 3:2 aspect ratio */}
      <div className="relative w-full" style={{ paddingBottom: "62%" }}>
        {offline ? (
          <div className="cam-feed-offline absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <VideoOff size={26} className="text-red-400/80" />
            <span className="font-mono text-[11px] font-black tracking-wider text-slate-300">NO SIGNAL</span>
            <span className="text-[10px] font-bold text-slate-500">Last frame {camera.lastSeen ?? "—"}</span>
          </div>
        ) : (
          <div
            className="cam-feed-placeholder absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-500"
            style={{ opacity: showVideo ? 0 : 1 }}
          >
            <Camera size={26} className="cam-feed-icon mb-2" />
            <span className="cam-feed-cam-id font-mono text-[11px] font-black tracking-wider">{camId}</span>
            <span className="cam-feed-location mt-1 max-w-[80%] text-center text-[10px] font-bold leading-tight">{location}</span>
            {!alwaysPlay && <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Hover to preview</span>}
          </div>
        )}

        {!offline && !videoFailed && (
          <video
            ref={videoRef}
            src={camera.videoFeed}
            muted
            loop
            playsInline
            preload={alwaysPlay ? "auto" : "none"}
            onError={handleVideoError}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
            style={{ opacity: showVideo ? 1 : 0, filter: status === "degraded" ? "brightness(1.15) contrast(0.8) blur(0.6px)" : undefined }}
          />
        )}

        {/* AI overlay (visible while the feed plays) */}
        {!offline && (
          <div className="pointer-events-none absolute inset-0 transition-opacity duration-500" style={{ opacity: showVideo ? 1 : 0 }}>
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30" />

            <div className="absolute left-2 top-2 flex items-center gap-1.5">
              <span className="cam-overlay-badge flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider">
                <span className="cam-overlay-live-dot inline-block h-1.5 w-1.5 rounded-full" />
                {camId}
              </span>
              <span className="cam-overlay-live-label rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-widest">
                {status === "degraded" ? "DEGRADED" : "LIVE"}
              </span>
            </div>

            <div className="absolute right-2 top-2">
              <span className="cam-overlay-ai-status flex items-center gap-1 rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-wider">
                <span className="cam-overlay-ai-dot inline-block h-1.5 w-1.5 rounded-full" />
                ANPR ACTIVE
              </span>
            </div>

            <div className="cam-bbox cam-bbox-vehicle absolute" style={{ top: "22%", left: "8%", width: "38%", height: "48%" }}>
              <div className="cam-bbox-corner cam-bbox-corner-tl" />
              <div className="cam-bbox-corner cam-bbox-corner-tr" />
              <div className="cam-bbox-corner cam-bbox-corner-bl" />
              <div className="cam-bbox-corner cam-bbox-corner-br" />
              <span className="cam-track-label absolute -top-4 left-0 rounded px-1 py-px text-[7px] font-bold tracking-wide">{trackData.tracks[0]}</span>
              <div className="cam-bbox cam-bbox-plate absolute" style={{ bottom: "8%", left: "15%", width: "55%", height: "18%" }}>
                <div className="cam-bbox-corner cam-bbox-corner-tl" />
                <div className="cam-bbox-corner cam-bbox-corner-tr" />
                <div className="cam-bbox-corner cam-bbox-corner-bl" />
                <div className="cam-bbox-corner cam-bbox-corner-br" />
              </div>
            </div>

            <div className="cam-bbox cam-bbox-vehicle absolute" style={{ top: "30%", left: "55%", width: "32%", height: "40%" }}>
              <div className="cam-bbox-corner cam-bbox-corner-tl" />
              <div className="cam-bbox-corner cam-bbox-corner-tr" />
              <div className="cam-bbox-corner cam-bbox-corner-bl" />
              <div className="cam-bbox-corner cam-bbox-corner-br" />
              <span className="cam-track-label absolute -top-4 left-0 rounded px-1 py-px text-[7px] font-bold tracking-wide">{trackData.tracks[1]}</span>
            </div>

            <div className="absolute bottom-2 left-2 flex flex-col gap-0.5">
              <span className="cam-overlay-plate-label rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-wider">Plate detected</span>
              <span className="cam-overlay-plate-info rounded px-1.5 py-0.5 text-[7px] font-bold tracking-wide">
                {plate}
                {ocr ? ` · OCR ${ocr.toFixed(1)}%` : ""}
              </span>
            </div>

            <div className="absolute bottom-2 right-2">
              <span className="cam-overlay-meta rounded px-1.5 py-0.5 text-[7px] font-bold tracking-wide">
                {camera.fps} FPS · {camera.resolution?.split(" ")[0] || "1080p"}
              </span>
            </div>

            <div className="cam-scanline absolute inset-0" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="cam-feed-footer px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="cam-feed-footer-id font-mono text-[11px] font-black tracking-wider">{camId}</span>
            <span className="cam-feed-footer-loc truncate text-[10px] font-bold">{location}</span>
          </div>
          <span className={`tn-status tn-status--${status}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        {!compact && camera.lastHour !== undefined && (
          <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-[10px]">
            <div>
              <dt className="font-bold uppercase tracking-wider text-gray-400">Reads/h</dt>
              <dd className="mt-0.5 font-mono font-black text-gray-800">{offline ? "—" : camera.lastHour.toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-wider text-gray-400">OCR</dt>
              <dd className={`mt-0.5 font-mono font-black ${ocr == null ? "text-gray-400" : ocr >= OCR_ACCURACY_TARGET ? "text-emerald-600" : "text-amber-600"}`}>
                {ocr == null ? "—" : `${ocr.toFixed(1)}%`}
              </dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-wider text-gray-400">FPS</dt>
              <dd className="mt-0.5 font-mono font-black text-gray-800">{camera.fps || "—"}</dd>
            </div>
          </dl>
        )}
      </div>
    </Tag>
  );
}
