import { useEffect, useState } from "react";
import { fetchStreams } from "./api";

/**
 * Live CCTV stream directory (MediaMTX RTSP → HLS restream), shared by every camera card.
 * One request for the whole app, refreshed every 30 s; cards fall back to the recorded MP4 when a
 * camera has no live stream (MediaMTX not running, or backend offline).
 */

const REFRESH_MS = 30000;
let cache = { at: 0, byCamera: {} };
let pending = null;
const listeners = new Set();

async function refresh() {
  if (!pending) {
    pending = fetchStreams()
      .then((data) => {
        const byCamera = {};
        for (const s of data?.streams ?? []) if (s.live) byCamera[s.camera_id] = s;
        cache = { at: Date.now(), byCamera };
        listeners.forEach((fn) => fn(cache.byCamera));
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** The live stream for a camera code ("CAM-401"), or null. */
export function useLiveStream(cameraCode) {
  const [byCamera, setByCamera] = useState(cache.byCamera);
  useEffect(() => {
    listeners.add(setByCamera);
    if (Date.now() - cache.at > REFRESH_MS) refresh();
    const timer = setInterval(() => Date.now() - cache.at > REFRESH_MS && refresh(), REFRESH_MS);
    return () => {
      listeners.delete(setByCamera);
      clearInterval(timer);
    };
  }, []);
  return byCamera[cameraCode] ?? null;
}

/**
 * Play an HLS URL in a <video>. hls.js is loaded on demand (Safari plays HLS natively).
 * Returns a cleanup function; `onFatal` fires when the stream cannot be played.
 */
export async function attachHls(video, url, onFatal) {
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return () => video.removeAttribute("src");
  }
  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) {
    onFatal?.();
    return () => {};
  }
  const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 6 });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (data.fatal) {
      hls.destroy();
      onFatal?.();
    }
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}
