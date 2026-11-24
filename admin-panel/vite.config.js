import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is /admin/ because the backend serves this build at that path when
// SERVE_STATIC is on. Without it the built index.html asks for /assets/... and
// gets the student app's 404.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  // Libraries go in their own files. They change far less often than the
  // app code, so a deploy does not make browsers download them again.
  build: {
    rollupOptions: {
      // video-render.html: the page the server records lesson videos from
      // (backend utils/lessonRender.js).
      input: { main: "index.html", slidePrint: "slide-print.html", videoRender: "video-render.html" },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("katex")) return "katex";
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(id)) return "react";
          if (/@reduxjs|react-redux|[\\/]redux|reselect|immer/.test(id)) return "redux";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin in development too, so cookies behave exactly as they will
      // in production and there is no CORS to configure.
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
      // Uploaded images and pdfs. The backend serves these from /media, so
      // without this the browser asks vite for them and gets a 404 — the
      // upload succeeds and the picture never appears.
      "/media": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
    },
  },
});
