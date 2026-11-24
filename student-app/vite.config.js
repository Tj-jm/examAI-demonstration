import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served at the root by the backend (SERVE_STATIC), unlike the admin panel
// which lives under /admin/ — no base path override needed here.
export default defineConfig({
  plugins: [react()],
  // Libraries go in their own files. They change far less often than the
  // app code, so a deploy does not make browsers download them again.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/@mui|@emotion/.test(id)) return "mui";
          if (id.includes("katex")) return "katex";
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(id)) return "react";
          if (/@reduxjs|react-redux|[\\/]redux|reselect|immer/.test(id)) return "redux";
        },
      },
    },
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    port: 5174,
    proxy: {
      // Same-origin in development too, so the student session cookie
      // behaves exactly as it will in production.
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
      "/media": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
      // Backend-generated, not static files in this app — without these,
      // Vite's dev server falls through to its own SPA catch-all and serves
      // index.html (complete with the dev-only @react-refresh/@vite/client
      // script tags) at these paths instead, which is exactly what a
      // crawler or Lighthouse then flags as "not valid".
      "/robots.txt": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
      "/sitemap.xml": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
      // Dev only: the admin panel's dev server, so one tunnel link serves
      // both (<link>/admin/), the same paths as production.
      "/admin": {
        target: "http://localhost:5173",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
