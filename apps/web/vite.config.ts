import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The backend contract (docs/API_CONTRACT.md) expects the frontend to proxy
// /api and /ws to the Fastify server, normally on port 3001.
const backend = process.env.INTERSECTION_BACKEND_URL ?? "http://127.0.0.1:3001";

let warnedUnavailable = false;
function quietWhenOffline(proxy: Parameters<NonNullable<ProxyOptions["configure"]>>[0]) {
  proxy.on("error", (error, _req, res) => {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn(`[intersection] backend ${backend} unavailable (${error.message}); the app runs in offline demo mode.`);
    }
    // HTTP requests get a 502 the frontend treats as "backend offline".
    // Socket upgrades hand over a raw socket, which has no writeHead.
    const response = res as ServerResponse<IncomingMessage> | undefined;
    if (response && typeof response.writeHead === "function" && !response.headersSent) {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ unavailable: true }));
    } else {
      res?.end();
    }
  });
}

const proxy: Record<string, ProxyOptions> = {
  "/api": { target: backend, changeOrigin: true, configure: quietWhenOffline },
  "/ws": { target: backend.replace(/^http/, "ws"), ws: true, changeOrigin: true, configure: quietWhenOffline },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: { proxy },
  preview: { proxy },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
