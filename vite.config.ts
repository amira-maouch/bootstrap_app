import path from "node:path";
import { fileURLToPath } from "node:url";
import { createViteConfig } from "@heron-ws/app-runtime";
import egretConfig from "./app.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createViteConfig({
  root: __dirname,
  egretConfig,
  apiPort: 3002,
  override: {
    server: {
      port: 5174,
    },
  },
});
