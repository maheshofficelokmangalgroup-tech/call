// Starts the production build of the panel.
//
// `next build` writes a self-contained server to .next/standalone (this is what the Docker image ships). That server
// expects the compiled browser files (.next/static) and the public folder beside it, so they are copied there first.
//
//   npm run build && npm start            -> http://0.0.0.0:3000
//   PORT=3100 HOSTNAME=127.0.0.1 npm start
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");

if (!existsSync(server)) {
  console.error("There is no production build yet. Run `npm run build` first.");
  process.exit(1);
}

cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.PORT ?? "3000", HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
