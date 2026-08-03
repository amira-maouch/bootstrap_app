import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { createViteConfig } from "@heron-ws/app-runtime";
import egretConfig from "./app.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = loadEnv("development", __dirname, "EGRET_");

const rawHosts = [env.EGRET_FAKE_API_URL]
  .filter((url): url is string => Boolean(url) && !url.startsWith("/"))
  .map((url) => new URL(url).origin);

const connectSrcHosts = [...new Set(rawHosts)];

// Vite's dev server injects imported CSS (`import "./index.css"` in main.tsx)
// via a JS <style> tag so edits can hot-reload without a full page reload.
// That JS runs after the SSR'd HTML has already painted, so every navigation
// flashes unstyled markup for a frame before Bootstrap applies. Production
// doesn't have this problem: `vite build` extracts the same CSS into a real
// file and writes a render-blocking `<link>` into dist/index.html. This
// plugin adds that same `<link>` for dev only (guarded by `command ===
// "serve"`) so the initial paint is already styled, matching prod; it's a
// harmless duplicate load alongside the JS-injected copy that still hot-reloads.
function devCriticalCssPlugin(): Plugin {
  let isServe = false;
  return {
    name: "bootstrap-dev-critical-css",
    configResolved(config) {
      isServe = config.command === "serve";
    },
    transformIndexHtml(html) {
      if (!isServe || html.includes("data-egret-dev-critical-css")) {
        return html;
      }
      return html.replace(
        "</head>",
        `<link rel="stylesheet" href="/index.css" data-egret-dev-critical-css="true"></head>`,
      );
    },
  };
}

export default createViteConfig({
  root: __dirname,
  egretConfig,
  port: 5174,
  connectSrcHosts,
  plugins: [devCriticalCssPlugin()],
});
