import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "@heron-ws/app-runtime";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.resolve(__dirname, ".");

export default defineConfig({
  metadataDir: APP_ROOT,
  middlewaresDir: path.join(APP_ROOT, "middlewares"),
  // Base URL of the backend API — forwarded to server-side widget loaders via `ctx.egret.apiBase`.
  apiBase: process.env.EGRET_API_BASE_URL ?? "http://localhost:4001",
  authorization: {
    enabled: true,
    tokenKey: "auth_token",
    unauthorizedPath: "/unauthorized",
    auth: {
      adapter: "./authorization/auth-adapter.ts",
      session: {
        cookie: {
          name: "bootstrap_session",
          lifetimeSeconds: 1800,
          sameSite: "lax",
          secure: "auto",
        },
      },
      loginPath: "/login",
      returnToParam: "returnTo",
    },
  },
  // V6.5: public and supported protected routes use the same document path.
  // Protected routes are authenticated with the HttpOnly session before any
  // metadata or server widget loader runs.
  ssr: {
    enabled: true,
    abortTimeoutMs: 10_000,
    // Shared HTML caching starts with one explicitly public route. Any Cookie,
    // Authorization header, or route `can` rule forces a bypass.
    cache: {
      publicRoutes: ["/login"],
      maxAgeSeconds: 30,
      maxEntries: 50,
    },
  },
});
