/**
 * Server-side loader for the Settings widget.
 *
 * MEANINGFUL EXAMPLE + EDGE CASE SHOWCASE
 *
 * Fetches the current user's profile from the fake API so the settings form
 * can be pre-populated with real data instead of the hardcoded "John Doe" /
 * "john@example.com" static props in metadata.json.
 *
 * This file deliberately demonstrates every documented edge case in comments
 * so it doubles as an annotated reference.
 */
import type { ServerContext } from "@heron-ws/app-runtime";

export default async function (ctx: ServerContext) {
  const { token } = ctx.session;
  const { apiBase } = ctx.egret;

  // ── EDGE CASE 1: No token ───────────────────────────────────────────────
  // The settings page is admin-only (protected by a route `can` in
  // app-manifest.json), so a request reaching this loader always has a token
  // in practice. But loaders must never assume that 
  if (!token) {
    console.warn("[settings/server] no token — returning empty props");
    return {};
  }

  // If the app owner forgets to set `apiBase` in app.config.ts, every fetch
  // would resolve against "" which throws. Bail early with a warning instead.
  if (!apiBase) {
    console.warn("[settings/server] apiBase not configured — skipping pre-fetch");
    return {};
  }

  // ── NORMAL PATH ─────────────────────────────────────────────────────────
  // Fake-API endpoint: GET /api/auth/me — returns the profile for the bearer.
  const res = await fetch(`${apiBase}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // ── EDGE CASE 3: Non-200 response ───────────────────────────────────────
  // Never throw on a bad HTTP status — just return {} and let the page render
  // with its static props. The client can show its own error or retry.
  if (!res.ok) {
    console.warn(`[settings/server] /api/auth/me → ${res.status}`);
    return {};
  }

  const json = (await res.json()) as { data?: { name?: string; email?: string; role?: string } };
  const profile = json?.data ?? {};

  return {
    profileName: profile.name ?? "Unknown",
    profileEmail: profile.email ?? "",
    profileRole: profile.role ?? "",
  };

}
