/**
 * Bootstrap App permissions LOADER (Heron Option 2).
 *
 * Fetches this token's permissions from the fake API, in the fake API's OWN
 * native format — a flat list of "action:subject" grant strings (or "*" for
 * everything). This is I/O only: it knows nothing about Heron's rule shape.
 * That translation is `authorization/permissions-adapter.ts`'s job, not this
 * file's.
 *
 * `token` is the backend credential from a verified identity. Browser widget
 * requests may supply the compatibility browserToken as Bearer; SSR gets the
 * same credential from Heron's HttpOnly cookie.
 *
 * Composed by `authorization/auth-adapter.ts`'s loadPermissions() method. It
 * runs only in Node and is never bundled to the browser.
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
