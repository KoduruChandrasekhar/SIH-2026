import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "three-renderer": ["three", "@react-three/fiber", "@react-three/drei"],
          "map-renderer": ["@deck.gl/core", "@deck.gl/layers", "@deck.gl/react", "react-map-gl", "maplibre-gl"],
          "chart-renderer": ["recharts"],
        },
      },
    },
  },
});
