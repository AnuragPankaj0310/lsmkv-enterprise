import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    /**
     * Dev proxy — mirrors what Nginx does in production.
     * /api/*  →  http://localhost:8000/*  (strips /api prefix)
     * /ws/*   →  ws://localhost:8000/ws/* (upgrades connection)
     *
     * This makes `fetch("/api/cluster")` and `new WebSocket("/ws/metrics")`
     * work identically in development and behind the Nginx reverse proxy.
     */
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});