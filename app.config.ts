import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "@heron-ws/app-runtime";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.resolve(__dirname, ".");

export default defineConfig({
  metadataDir: APP_ROOT,
  middlewaresDir: path.join(APP_ROOT, "middlewares"),
  authorization: {
    enabled: true,
    permissions: {
      loader: "./authorization/permissions-loader.ts",
      adapter: "./authorization/permissions-adapter.ts",
    },
    tokenKey: "auth_token",
  },
});
