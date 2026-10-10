import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API server binds 127.0.0.1 (see server/src/index.ts). Proxy to that address rather than
// "localhost", which can resolve to ::1 first and fail. PORT matches the server's PORT.
const apiTarget = `http://127.0.0.1:${process.env.PORT ?? "4317"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Server-Sent Events: http-proxy streams the response as it arrives. The server sends
      // `Cache-Control: no-cache` and no compression, so nothing in between buffers it.
      "/api": { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.ts",
  },
});
