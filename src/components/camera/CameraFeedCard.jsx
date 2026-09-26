import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Camera, VideoOff, X } from "lucide-react";
import { OCR_ACCURACY_TARGET } from "../../data/data";
import { formatAge } from "../../sim/liveSim";
import { AnimatedNumber } from "../motion/Motion";
import { attachHls, useLiveStream } from "../../lib/streams";

const TRACK_DATA = [
  { tracks: ["TRACK-017", "TRACK-024"] },
  { tracks: ["TRACK-031", "TRACK-009"] },
  { tracks: ["TRACK-042", "TRACK-018"] },
  { tracks: ["TRACK-005", "TRACK-053"] },
];

const STATUS_LABEL = {
  online: "Live",
  degraded: "Degraded",
  offline: "Offline",
};

const posterFor = (src) => src?.replace(/\.mp4$/, "-poster.jpg");

export default function CameraFeedCard({
  camera,
  live,
  simSec,
  index = 0,
  onSelect,
  selected = false,
  alwaysPlay = false,
  compact = false,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [buffering, setBuffering] = useState(alwaysPlay);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Annotated clips are generated locally (git-ignored); deployments without them show the raw feed
  const [annotatedFailed, setAnnotatedFailed] = useState(false);
  // idle tiles show a still frame from the camera's footage (falls back to the plain placeholder)
  const [stillFailed, setStillFailed] = useState(false);

  const videoRef = useRef(null);

  const status = String(camera.status || "online").toLowerCase();
  const offline = status === "offline" || !camera.videoFeed;
  const trackData = TRACK_DATA[index % TRACK_DATA.length];

  const camId =
    camera.code ||
    camera.id?.replace(" #", "-") ||
    camera.id?.replace("#", "-").replace(" ", "") ||
    `CAM-${index + 1}`;

  const location = camera.name || camera.location || "CCTV Feed";

  const plate =
    live?.lastPlate ||
    camera.lastPlate ||
    camera.lastPlateRead;

  const ocr = camera.ocrRate;
  const fps = live?.fps ?? camera.fps;
  const readsPerHour = live?.lastHour ?? camera.lastHour;

  const lastReadAge =
    simSec != null && live?.lastReadSec != null
      ? simSec - live.lastReadSec
      : null;

  const videoSrc =
    camera.videoFeed || `/camera-feeds/${camId}.mp4`;

  // Live CCTV: MediaMTX RTSP restream over HLS when available, else the recorded MP4
  const stream = useLiveStream(camId);
  const [liveFailed, setLiveFailed] = useState(false);
  const useLive = Boolean(stream) && !liveFailed;

  // Real YOLO11 + ByteTrack annotated video
  const modalVideoSrc =
    `/camera-feeds/${camId}_annotated.mp4`;

  const showVideo =
    !offline &&
    !videoFailed &&
    (alwaysPlay || isHovered);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !useLive || !showVideo) return;

    let cleanup = () => {};
    let cancelled = false;
    setBuffering(true);
    attachHls(video, stream.hls_url, () => setLiveFailed(true)).then((detach) => {
      if (cancelled) return detach();
      cleanup = detach;
      video.play().catch(() => {});
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [useLive, showVideo, stream?.hls_url]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || useLive) return;

    if (showVideo) {
      video.play().catch((err) => {
        if (err.name !== "AbortError") {
          setVideoFailed(true);
        }
      });
    } else {
      video.pause();

      if (!alwaysPlay) {
        video.currentTime = 0;
      }
    }
  }, [showVideo, alwaysPlay, useLive]);

  const handleVideoError = useCallback(() => {
    setVideoFailed(true);
  }, []);

  const handleCardClick = useCallback(
    (event) => {
      event?.stopPropagation();

      if (onSelect) {
        onSelect(camera);
      }

      // Open real annotated AI video
      setIsModalOpen(true);
    },
    [camera, onSelect]
  );

  const closeModal = useCallback((event) => {
    event?.stopPropagation();
    setIsModalOpen(false);
  }, []);

  const Tag = onSelect ? "button" : "div";

  return (
    <>
      <Tag
        type={onSelect ? "button" : undefined}
        onClick={handleCardClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        aria-label={`${camId} ${location} — ${
          STATUS_LABEL[status] ?? status
        }. Open camera details`}
        className={`cam-feed-card group relative block w-full overflow-hidden rounded-[20px] border border-gray-200/80 text-left shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] ${
          selected ? "is-selected" : ""
        }`}
      >
        {/* Camera viewport */}
        <div
          className="relative w-full overflow-hidden bg-[#0b1220]"
          style={{ paddingBottom: "62%" }}
        >
          {offline ? (
            <div className="cam-feed-offline absolute inset-0 flex flex-col items-center justify-center gap-1.5">
              <VideoOff
                size={26}
                className="text-red-400/80"
              />

              <span className="cam-feed-cam-id font-mono text-[11px] font-black tracking-wider">
                NO SIGNAL
              </span>

              <span className="text-[10px] font-bold text-slate-500">
                Last seen{" "}
                {simSec != null && live?.lastReadSec != null
                  ? formatAge(simSec - live.lastReadSec)
                  : camera.lastSeen ?? "—"}
              </span>
            </div>
          ) : (
            <>
              {/* Idle tile: a still frame from this camera's footage, slowly drifting */}
              {!showVideo && !stillFailed && (
                <div className="cam-feed-still-wrap absolute inset-0" aria-hidden="true">
                  <img
                    src={posterFor(videoSrc)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="cam-feed-still"
                    style={{ animationDelay: `${-(parseInt(camId.replace(/\D/g, ""), 10) % 7) * 2}s` }}
                    onError={() => setStillFailed(true)}
                  />
                  <span className="cam-feed-still-shade" />
                </div>
              )}

              {/* Camera placeholder (no still available) */}
              {!showVideo && stillFailed && (
                <div className="cam-feed-placeholder absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-500">
                  <Camera
                    size={26}
                    className="cam-feed-icon mb-2"
                  />

                  <span className="cam-feed-cam-id font-mono text-[11px] font-black tracking-wider">
                    {camId}
                  </span>

                  <span className="cam-feed-location mt-1 max-w-[80%] text-center text-[10px] font-bold leading-tight">
                    {location}
                  </span>

                  {!alwaysPlay && (
                    <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      Hover to preview
                    </span>
                  )}
                </div>
              )}

              {/* Live badge */}
              <div
                className="absolute left-2 top-2 flex items-center gap-1.5"
                style={{
                  opacity: showVideo ? 0 : 1,
                  transition: "opacity 200ms",
                }}
              >
                <span className="cam-live-badge">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "degraded"
                        ? "bg-amber-400"
                        : "tn-pulse tn-pulse--red bg-red-500"
                    }`}
                    aria-hidden="true"
                  />

                  {status === "degraded"
                    ? "DEGRADED"
                    : "LIVE"}
                </span>
              </div>

              {!alwaysPlay && (
                <span className="cam-hover-hint absolute bottom-2 right-2 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.18em] opacity-80 transition-opacity group-hover:opacity-0">
                  Hover to play
                </span>
              )}

              {/* Camera video */}
              {!videoFailed && (
                <video
                  key={useLive ? "live" : "replay"}
                  ref={videoRef}
                  src={useLive ? undefined : videoSrc}
                  poster={posterFor(videoSrc)}
                  muted
                  loop
                  playsInline
                  preload={alwaysPlay ? "auto" : "none"}
                  onError={handleVideoError}
                  onLoadedData={() => setBuffering(false)}
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
                  style={{
                    opacity: showVideo ? 1 : 0,
                    filter:
                      status === "degraded"
                        ? "brightness(1.15) contrast(0.8) blur(0.6px)"
                        : undefined,
                  }}
                />
              )}

              {buffering && showVideo && (
                <div
                  className="tn-skeleton absolute inset-0"
                  aria-hidden="true"
                />
              )}

              {/* AI overlay */}
              <div
                className="pointer-events-none absolute inset-0 transition-opacity duration-300"
                style={{
                  opacity: showVideo ? 1 : 0,
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30" />

                {/* Camera ID */}
                <div className="absolute left-2 top-2 flex items-center gap-1.5">
                  <span className="cam-overlay-badge flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider">
                    <span className="cam-overlay-live-dot inline-block h-1.5 w-1.5 rounded-full" />
                    {camId}
                  </span>

                  <span className="cam-overlay-live-label rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-widest" title={useLive ? `${stream.rtsp_url} — ${stream.origin}` : undefined}>
                    {status === "degraded"
                      ? "DEGRADED"
                      : useLive
                        ? "LIVE · RTSP"
                        : "LIVE"}
                  </span>
                </div>

                {/* AI status */}
                <div className="absolute right-2 top-2">
                  <span className="cam-overlay-ai-status flex items-center gap-1 rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-wider">
                    <span className="cam-overlay-ai-dot inline-block h-1.5 w-1.5 rounded-full" />
                    ANPR ACTIVE
                  </span>
                </div>

                {/* Illustrative overlay for the recorded preview only — never drawn over the live stream */}
                {!useLive && (<>
                {/* Vehicle 1 */}
                <div
                  className="cam-bbox cam-bbox-vehicle absolute"
                  style={{
                    top: "22%",
                    left: "8%",
                    width: "38%",
                    height: "48%",
                  }}
                >
                  <div className="cam-bbox-corner cam-bbox-corner-tl" />
                  <div className="cam-bbox-corner cam-bbox-corner-tr" />
                  <div className="cam-bbox-corner cam-bbox-corner-bl" />
                  <div className="cam-bbox-corner cam-bbox-corner-br" />

                  <span className="cam-track-label absolute -top-4 left-0 rounded px-1 py-px text-[7px] font-bold tracking-wide">
                    {trackData.tracks[0]}
                  </span>

                  {/* Plate box */}
                  <div
                    className="cam-bbox cam-bbox-plate absolute"
                    style={{
                      bottom: "8%",
                      left: "15%",
                      width: "55%",
                      height: "18%",
                    }}
                  >
                    <div className="cam-bbox-corner cam-bbox-corner-tl" />
                    <div className="cam-bbox-corner cam-bbox-corner-tr" />
                    <div className="cam-bbox-corner cam-bbox-corner-bl" />
                    <div className="cam-bbox-corner cam-bbox-corner-br" />
                  </div>
                </div>

                {/* Vehicle 2 */}
                <div
                  className="cam-bbox cam-bbox-vehicle absolute"
                  style={{
                    top: "30%",
                    left: "55%",
                    width: "32%",
                    height: "40%",
                  }}
                >
                  <div className="cam-bbox-corner cam-bbox-corner-tl" />
                  <div className="cam-bbox-corner cam-bbox-corner-tr" />
                  <div className="cam-bbox-corner cam-bbox-corner-bl" />
                  <div className="cam-bbox-corner cam-bbox-corner-br" />

                  <span className="cam-track-label absolute -top-4 left-0 rounded px-1 py-px text-[7px] font-bold tracking-wide">
                    {trackData.tracks[1]}
                  </span>
                </div>

                {/* Plate information */}
                <div className="absolute bottom-2 left-2 flex flex-col gap-0.5">
                  <span className="cam-overlay-plate-label rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-wider">
                    Plate detected
                  </span>

                  <span className="cam-overlay-plate-info rounded px-1.5 py-0.5 text-[7px] font-bold tracking-wide">
                    {plate || "—"}
                    {ocr != null
                      ? ` · OCR ${ocr.toFixed(1)}%`
                      : ""}
                  </span>
                </div>
                </>)}

                {/* FPS */}
                <div className="absolute bottom-2 right-2">
                  <span className="cam-overlay-meta rounded px-1.5 py-0.5 text-[7px] font-bold tracking-wide">
                    {fps || "—"} FPS ·{" "}
                    {camera.resolution?.split(" ")[0] ||
                      "1080p"}
                  </span>
                </div>

                <div className="cam-scanline absolute inset-0" />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="cam-feed-footer px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="cam-feed-footer-id font-mono text-[11px] font-black tracking-wider">
                {camId}
              </span>

              <span className="cam-feed-footer-loc truncate text-[10px] font-bold">
                {location}
              </span>
            </div>

            <span
              className={`tn-status tn-status--${status}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden="true"
              />
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>

          {!compact && readsPerHour !== undefined && (
            <>
              <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-[10px]">
                <div>
                  <dt className="font-bold uppercase tracking-wider text-gray-400">
                    Reads/h
                  </dt>

                  <dd className="mt-0.5 font-mono font-black text-gray-800">
                    {offline ? (
                      "—"
                    ) : (
                      <AnimatedNumber value={readsPerHour} />
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="font-bold uppercase tracking-wider text-gray-400">
                    OCR
                  </dt>

                  <dd
                    className={`mt-0.5 font-mono font-black ${
                      ocr == null
                        ? "text-gray-400"
                        : ocr >= OCR_ACCURACY_TARGET
                          ? "text-emerald-600"
                          : "text-amber-600"
                    }`}
                  >
                    {ocr == null
                      ? "—"
                      : `${ocr.toFixed(1)}%`}
                  </dd>
                </div>

                <div>
                  <dt className="font-bold uppercase tracking-wider text-gray-400">
                    FPS
                  </dt>

                  <dd
                    className={`mt-0.5 font-mono font-black ${
                      status === "degraded"
                        ? "text-amber-600"
                        : "text-gray-800"
                    }`}
                  >
                    {offline ? "—" : fps || "—"}
                  </dd>
                </div>
              </dl>

              <p className="mt-2 truncate font-mono text-[10px] font-bold text-gray-500">
                {offline ? (
                  <span className="text-red-500">
                    Offline · last seen{" "}
                    {lastReadAge != null
                      ? formatAge(lastReadAge)
                      : camera.lastSeen ?? "—"}
                  </span>
                ) : (
                  <>
                    Last read{" "}
                    {lastReadAge != null
                      ? formatAge(lastReadAge)
                      : "—"}{" "}
                    ·{" "}
                    <span className="text-gray-700">
                      {plate || "—"}
                    </span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </Tag>

      {/* Fullscreen AI Annotated Video Modal */}
      {isModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md sm:p-6"
            onClick={closeModal}
          >
            <div
              className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)]"
              onClick={(event) => event.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />

                  <span className="font-mono text-sm font-black tracking-wider text-white">
                    {camId}
                  </span>

                  <span className="truncate text-xs font-semibold text-gray-400">
                    · {location}
                  </span>

                  <span className="ml-2 hidden rounded border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-blue-400 sm:inline">
                    {annotatedFailed ? "Recorded Feed" : "AI Annotated Stream"}
                  </span>
                </div>

                <button
                  onClick={closeModal}
                  className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                  aria-label="Close modal"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Real annotated video */}
              <div className="relative flex aspect-video min-h-[300px] w-full items-center justify-center bg-black">
                <video
                  src={annotatedFailed ? videoSrc : modalVideoSrc}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="h-full w-full max-h-[80vh] object-contain"
                  onError={() => setAnnotatedFailed(true)}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}