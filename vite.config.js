import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vendor code changes far less often than the app, so it gets its own long-cached chunks.
// (hls.js and leaflet.heat are dynamic imports and keep their own lazy chunks.)
const VENDOR_CHUNKS = [
  ["react", /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/],
  ["maps", /[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/],
  ["charts", /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|@reduxjs|redux|immer|reselect|es-toolkit)[\\/]/],
  ["icons", /[\\/]node_modules[\\/]lucide-react[\\/]/],
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // hls.js (~595 kB) is only fetched when a camera has a live MediaMTX stream
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return VENDOR_CHUNKS.find(([, re]) => re.test(id))?.[0];
        },
      },
    },
  },
});
