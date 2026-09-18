import { useState, useRef, useCallback } from "react";
import { Camera } from "lucide-react";

/**
 * CameraFeedCard — A simulated AI-powered CCTV camera feed card.
 *
 * Default: Shows a dark gradient placeholder with camera info.
 * Hover:   Smoothly transitions to a looping MP4 video with AI-style overlays
 *          (bounding boxes, tracking labels, plate detection indicator).
 * Leave:   Returns to the static placeholder.
 * Error:   Falls back to the static placeholder automatically.
 *
 * All overlays are simulated UI elements — no real YOLO/OCR is run.
 * Displayed plate numbers come from existing mock data (lastPlateRead).
 */

// Simulated tracking data per camera (keyed by camera index for variety)
const TRACK_DATA = [
  { tracks: ["TRACK-017", "TRACK-024"], plateConf: "96%" },
  { tracks: ["TRACK-031", "TRACK-009"], plateConf: "94%" },
  { tracks: ["TRACK-042", "TRACK-018"], plateConf: "97%" },
  { tracks: ["TRACK-005", "TRACK-053"], plateConf: "93%" },
];

export default function CameraFeedCard({ camera, index = 0 }) {
  const [isHovered, setIsHovered] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef(null);

  const trackData = TRACK_DATA[index % TRACK_DATA.length];
  const camId = camera.id.replace("#", "-").replace(" ", "");
  const videoSrc = camera.videoFeed || "/camera-feeds/CAM-401.mp4";

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (videoRef.current && !videoFailed) {
      videoRef.current.play().catch(() => setVideoFailed(true));
    }
  }, [videoFailed]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const handleVideoError = useCallback(() => {
    setVideoFailed(true);
  }, []);

  const showVideo = isHovered && !videoFailed;

  return (
    <div
      className="cam-feed-card group relative overflow-hidden rounded-[20px] border border-gray-200/80 shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)]"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Card viewport — fixed aspect ratio */}
      <div className="relative w-full" style={{ paddingBottom: "66%" }}>

        {/* ── Static Placeholder (default / fallback) ── */}
        <div
          className="cam-feed-placeholder absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-500"
          style={{ opacity: showVideo ? 0 : 1 }}
        >
          <Camera size={28} className="cam-feed-icon mb-2" />
          <span className="cam-feed-cam-id text-[11px] font-black tracking-wider">
            {camId}
          </span>
          <span className="cam-feed-location text-[9px] font-bold mt-1 max-w-[80%] text-center leading-tight">
            {camera.location}
          </span>
        </div>

        {/* ── Video Layer ── */}
        {!videoFailed && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            loop
            playsInline
            preload="metadata"
            onError={handleVideoError}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
            style={{ opacity: showVideo ? 1 : 0 }}
          />
        )}

        {/* ── AI Overlay Layer (visible on hover) ── */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-500"
          style={{ opacity: showVideo ? 1 : 0 }}
        >
          {/* Subtle dark vignette for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30" />

          {/* Top-left: Camera ID + Live indicator */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5">
            <span className="cam-overlay-badge flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase">
              <span className="cam-overlay-live-dot h-1.5 w-1.5 rounded-full inline-block" />
              {camId}
            </span>
            <span className="cam-overlay-live-label px-1.5 py-0.5 rounded text-[7px] font-extrabold tracking-widest uppercase">
              LIVE
            </span>
          </div>

          {/* Top-right: AI Tracking status */}
          <div className="absolute top-2 right-2">
            <span className="cam-overlay-ai-status flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-extrabold tracking-wider uppercase">
              <span className="cam-overlay-ai-dot h-1.5 w-1.5 rounded-full inline-block" />
              AI TRACKING
            </span>
          </div>

          {/* ── Vehicle Bounding Box 1 ── */}
          <div className="cam-bbox cam-bbox-vehicle absolute" style={{ top: "22%", left: "8%", width: "38%", height: "48%" }}>
            <div className="cam-bbox-corner cam-bbox-corner-tl" />
            <div className="cam-bbox-corner cam-bbox-corner-tr" />
            <div className="cam-bbox-corner cam-bbox-corner-bl" />
            <div className="cam-bbox-corner cam-bbox-corner-br" />
            {/* Track label */}
            <span className="cam-track-label absolute -top-4 left-0 px-1 py-px rounded text-[7px] font-bold tracking-wide">
              {trackData.tracks[0]}
            </span>

            {/* Plate bounding box (nested inside vehicle 1) */}
            <div className="cam-bbox cam-bbox-plate absolute" style={{ bottom: "8%", left: "15%", width: "55%", height: "18%" }}>
              <div className="cam-bbox-corner cam-bbox-corner-tl" />
              <div className="cam-bbox-corner cam-bbox-corner-tr" />
              <div className="cam-bbox-corner cam-bbox-corner-bl" />
              <div className="cam-bbox-corner cam-bbox-corner-br" />
            </div>
          </div>

          {/* ── Vehicle Bounding Box 2 ── */}
          <div className="cam-bbox cam-bbox-vehicle absolute" style={{ top: "30%", left: "55%", width: "32%", height: "40%" }}>
            <div className="cam-bbox-corner cam-bbox-corner-tl" />
            <div className="cam-bbox-corner cam-bbox-corner-tr" />
            <div className="cam-bbox-corner cam-bbox-corner-bl" />
            <div className="cam-bbox-corner cam-bbox-corner-br" />
            {/* Track label */}
            <span className="cam-track-label absolute -top-4 left-0 px-1 py-px rounded text-[7px] font-bold tracking-wide">
              {trackData.tracks[1]}
            </span>
          </div>

          {/* Bottom-left: Plate detection info */}
          <div className="absolute bottom-2 left-2 flex flex-col gap-0.5">
            <span className="cam-overlay-plate-label px-1.5 py-0.5 rounded text-[7px] font-extrabold tracking-wider uppercase">
              PLATE DETECTED
            </span>
            <span className="cam-overlay-plate-info px-1.5 py-0.5 rounded text-[7px] font-bold tracking-wide">
              {camera.lastPlateRead} · OCR {trackData.plateConf}
            </span>
          </div>

          {/* Bottom-right: FPS + Resolution */}
          <div className="absolute bottom-2 right-2">
            <span className="cam-overlay-meta px-1.5 py-0.5 rounded text-[7px] font-bold tracking-wide">
              {camera.fps}FPS · {camera.resolution?.split(" ")[0] || "4K"}
            </span>
          </div>

          {/* Scanline effect */}
          <div className="cam-scanline absolute inset-0" />
        </div>
      </div>

      {/* ── Card Footer ── */}
      <div className="cam-feed-footer px-3 py-2.5 flex items-center justify-between">
        <div className="flex flex-col min-w-0">
          <span className="cam-feed-footer-id text-[10px] font-black tracking-wider">{camId}</span>
          <span className="cam-feed-footer-loc text-[9px] font-bold truncate max-w-[140px]">
            {camera.location}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: camera.status === "Online" ? "#22c55e" : "#ef4444" }}
          />
          <span className="cam-feed-footer-status text-[9px] font-extrabold uppercase tracking-wider">
            {camera.status}
          </span>
        </div>
      </div>
    </div>
  );
}
