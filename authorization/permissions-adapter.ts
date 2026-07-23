/**
 * Bootstrap App permissions ADAPTER (Heron Option 2).
 *
 * A pure mapper — no I/O, no token, nothing async. Its only job is
 * translating the fake API's native grant strings (from
 * `authorization/permissions-loader.ts`) into Heron's `{ action, subject }`
 * rule shape:
 *
 *   "*"                   → { action: "*",      subject: "*" }
 *   "read:User"           → { action: "read",   subject: "User" }
 *   "command:users.purge" → { action: "command", subject: "users.purge" }
 *
 * (only the FIRST colon separates action from subject — subjects are free to
 * contain their own colons/dots).
 *
 * These are deliberately BUSINESS/domain permissions only ("can read/write a
 * User", "can run the users.purge command") — never page-view grants like
 * "view:page:users". Deciding which pages are reachable from which business
 * permissions is the APP's call, made once in app-manifest.json / widget
 * metadata `can` declarations (e.g. "Users" page = any of read/write/invite/
 * purge on User), not something the backend should need to know or maintain.
 *
 * ROW-LEVEL "own" grants — e.g. "read:Task:own" — are this adapter's job
 * too: the backend hands out the SAME static grant to every principal with
 * that role (see fake-api/data/permissions.json's "viewer" role), and this
 * adapter turns it into a rule with a `conditions` object scoped to THIS
 * caller specifically, using `raw.userId` (the caller's own id, resolved by
 * the fake API from the Bearer token — see permissions-loader.ts). This is
 * why two different "viewer" personas each only ever see their own rows:
 * same grant, different `userId`, different `conditions` at adapt time.
 * `conditions` is intentionally untyped end-to-end (see
 * `AuthorizationRule.conditions` in @heron-ws/component-api) — this app
 * happens to produce a plain object here, which `can(action, subject,
 * resource)` matches automatically, but nothing stops another adapter from
 * producing an array, a list of ids, or any other shape a widget script
 * would read back via `$egret.auth.getPermission()` and interpret itself.
 *
 * Loaded once by Heron's runtime server (Node) from
 * `authorization.permissions.adapter` in app.config.ts.
 */
import type { RawPermissions } from "./permissions-loader";

type AuthorizationRule = {
  action: string;
  subject: string;
  conditions?: unknown;
};

/** Which field on a subject's rows identifies "this is mine" — demo-only. */
const OWNER_FIELD_BY_SUBJECT: Record<string, string> = {
  Task: "assigneeId",
};

function grantToRule(grant: string, userId: string | undefined): AuthorizationRule {
  if (grant === "*") return { action: "*", subject: "*" };

  const ownMatch = /^([^:]+):([^:]+):own$/.exec(grant);
  if (ownMatch) {
    const [, action, subject] = ownMatch;
    const ownerField = OWNER_FIELD_BY_SUBJECT[subject] ?? "ownerId";
    return { action, subject, conditions: { [ownerField]: userId ?? null } };
  }

  const idx = grant.indexOf(":");
  if (idx === -1) return { action: grant, subject: "*" };
  return { action: grant.slice(0, idx), subject: grant.slice(idx + 1) };
}

export function adaptPermissions(raw: RawPermissions): AuthorizationRule[] {
  const grants = raw?.grants ?? [];
  return grants.map((grant) => grantToRule(grant, raw?.userId));
}

export default adaptPermissions;
