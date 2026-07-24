/**
 * Server-side loader for the Users widget.
 *
 * MEANINGFUL EXAMPLE — eliminates the client-side data waterfall.
 *
 * Without this file, the users page mounts showing "Loading…" in every row,
 * then `script.ts` fires a fetch after the widget is ready and re-renders.
 * With this loader, the server fetches the users list before the tree is sent,
 * merging `{ users }` into the widget's props. `script.ts` reads
 * `$self.getProps().users` and skips its own fetch entirely — the page renders
 * with real data on the very first paint.
 *
 * Pattern:
 *   server.ts → fetch data → return plain object
 *   script.ts → $self.getProps().users ?? client fetch fallback
 */
import type { ServerContext } from "@heron-ws/app-runtime";

export default async function (ctx: ServerContext) {
  const { token } = ctx.session;
  const { apiBase } = ctx.egret;

  // No token = unauthenticated request. Return empty so the client's own
  // token-aware fetch runs after the user logs in.
  // EDGE CASE: no token → return {} silently.
  if (!token) {
    return {};
  }

  if (!apiBase) {
    console.warn("[users/server] apiBase not configured — skipping pre-fetch");
    return {};
  }

  const res = await fetch(`${apiBase}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // EDGE CASE: non-200 response → return {} so client handles it.
  // The /api/users endpoint returns 403 for viewers without read:User permission.
  // We intentionally don't throw — a 403 here must not block the page load;
  // the client script will show its own "Forbidden" message.
  if (!res.ok) {
    console.warn(`[users/server] /api/users → ${res.status}, skipping pre-fetch`);
    return {};
  }

  const json = (await res.json()) as { data?: unknown };
  const users = Array.isArray(json?.data) ? json.data : [];

  // EDGE CASE: return must be a plain object, NOT an array.
  // runWidgetLoaders only merges plain objects — returning an array would be
  // silently ignored. Wrap lists in a named key.
  return { users };
}
