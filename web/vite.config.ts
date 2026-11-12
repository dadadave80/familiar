import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
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
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        legacy: fileURLToPath(new URL("./legacy/index.html", import.meta.url)),
        outing: fileURLToPath(new URL("./outing/index.html", import.meta.url)),
      },
      output: {
        manualChunks: (id) => (id.includes("/phaser/") ? "phaser" : undefined),
      },
    },
  },
});
