/**
 * Server-side loader for the Dashboard widget.
 *
 * This file is compiled to `dist-app/server/pages/dashboard/server.js` by
 * `egret-build-widgets` and executed on the server during page resolution.
 * Its return value is merged into the dashboard widget's `props` before the
 * metadata tree is sent to the browser.
 *
 * The widget script (`script.ts`) reads `$self.getProps().tasks` and skips
 * its own client-side fetch when tasks are already present — a graceful
 * client-side fallback still runs when the loader wasn't available (e.g.
 * when fetching a raw section reference).
 *
 * Row-level filtering (based on `read:Task` / `read:Task:own` rules) still
 * happens entirely on the CLIENT in `script.ts` — the server loader fetches
 * ALL tasks and hands them to the client, which applies `getPermission()`-
 * based conditions to decide what each user sees. The real backend must
 * enforce the same restriction server-side; the client rule is UX only.
 */

import type { ServerContext } from "@heron-ws/app-runtime";

export default async function loader(ctx: ServerContext) {
  console.log("server looooooog")
  const { token } = ctx.session;
  const apiBase = ctx.egret.apiBase;

  if (!apiBase) {
    console.warn(
      "[dashboard/server] ctx.egret.apiBase is empty — set `apiBase` in app.config.ts or EGRET_API_BASE_URL env var",
    );
    return {};
  }

  if (!token) {
    // No auth token — the middleware hasn't authenticated this request yet.
    // Return nothing; the client script will fetch tasks after auth completes.
    return {};
  }

  const res = await fetch(`${apiBase}/api/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.warn(
      `[dashboard/server] /api/tasks responded ${res.status} — skipping server pre-fetch`,
    );
    return {};
  }

  const json = (await res.json()) as { data?: unknown };
  const tasks = Array.isArray(json?.data) ? json.data : [];
  console.log("tasks", tasks)
  return { tasks };
}
