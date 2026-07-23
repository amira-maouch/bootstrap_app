/**
 * Bootstrap App permissions LOADER (Heron Option 2).
 *
 * Fetches this token's permissions from the fake API, in the fake API's OWN
 * native format — a flat list of "action:subject" grant strings (or "*" for
 * everything). This is I/O only: it knows nothing about Heron's rule shape.
 * That translation is `authorization/permissions-adapter.ts`'s job, not this
 * file's.
 *
 * `token` is fully opaque to Heron — it's whatever value your app put in
 * localStorage under `authorization.tokenKey`, handed here exactly as
 * received on the `Authorization: Bearer …` header. This file is the only
 * place that has to know it happens to be the fake API's session token.
 *
 * Loaded once by Heron's runtime server (Node) from
 * `authorization.permissions.loader` in app.config.ts. Never bundled to the
 * browser — the client only ever talks to Heron's own `/api/auth/permissions`,
 * which calls into this file for you.
 */
/**
 * `userId` is the CURRENT caller's own id, as resolved server-side by the
 * fake API from the Bearer token — needed by the adapter to turn "own
 * resource" grants (e.g. "read:Task:own") into a per-user condition
 * (`{ assigneeId: <this user's id> }`) without the backend having to bake a
 * different rule per user into permissions.json.
 */
export type RawPermissions = { grants: string[]; userId?: string };

function fakeApiBase(): string {
  return (
    process.env.EGRET_FAKE_API_URL ||
    process.env.FAKE_API_URL ||
    "http://localhost:4001"
  ).replace(/\/+$/, "");
}

export async function loadPermissions(
  token: string | null,
): Promise<RawPermissions> {
  if (!token) return { grants: [] };
  try {
    const res = await fetch(
      `${fakeApiBase()}/api/authorization/permissions`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return { grants: [] };
    const json = await res.json();
    const grants: string[] = Array.isArray(json?.data?.grants)
      ? json.data.grants
      : [];
    const userId: string | undefined =
      typeof json?.data?.userId === "string" ? json.data.userId : undefined;
    return { grants, userId };
  } catch (err) {
    console.warn("[permissions-loader] loadPermissions failed:", err);
    return { grants: [] };
  }
}

export default loadPermissions;
