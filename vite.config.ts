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

export default createViteConfig({
  root: __dirname,
  egretConfig,
  port: 5174,
  connectSrcHosts,
  plugins: [],
});
