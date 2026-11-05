import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3037",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/npc-api": {
        target: "http://127.0.0.1:3038",
        rewrite: (path) => path.replace(/^\/npc-api/, ""),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("/phaser/") ? "phaser" : undefined),
      },
    },
  },
});
