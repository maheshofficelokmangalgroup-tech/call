import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The browser only ever talks to its own origin: /api/* is forwarded to the FastAPI backend (a reverse proxy does the same on a
// server, see README.md), so no CORS setup is needed and the sign-in tokens never travel to a third-party address.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const proxy = { "/api": { target: backend, changeOrigin: false, xfwd: true } };

// Headers for the built app (`npm start` / `vite preview`). A server in front of the static files must send the same ones;
// README.md has a Caddy example. Everything the page loads comes from its own origin; recordings may come from a signed https link.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy, headers: securityHeaders },
  build: { sourcemap: false, chunkSizeWarningLimit: 600 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: false,
  },
});
