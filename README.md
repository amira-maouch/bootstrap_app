# Bootstrap App — Fake Express API + Heron Authorization

Demo app for **Heron Option 2** authorization with a real Express backend (JSON files, no DB).

## Personas

| Persona | Login | Backend grants (business permissions only) | Pages this unlocks |
|---|---|---|---|
| **Ada Admin** | `userId: admin` / password `admin` | `*` (wildcard — can do anything) | Dashboard (all tasks), Users (+ Invite + Purge), Settings |
| **Ed Editor** | `userId: editor` / password `editor` | `read:User`, `write:User`, `command:users.invite`, `read:Task` | Dashboard (all tasks), Users (+ Invite) — **not** Purge, **not** Settings |
| **Vic Viewer** | `userId: viewer` / password `viewer` | `read:Task:own` | Dashboard — **only their own task row** |
| **Val Viewer** | `userId: viewer2` / password `viewer2` | `read:Task:own` (same role as Vic!) | Dashboard — **only their own task row** (a different one than Vic's) |

Note what the backend does **not** grant: there is no `view:page:dashboard` /
`view:page:users` / `view:page:settings` permission anywhere in
[`fake-api/data/permissions.json`](fake-api/data/permissions.json). The
backend only ever hands out business/domain permissions — who can read/write
a `User`, who can run `users.invite` / `users.purge`. See
[Page access policy](#page-access-policy) for who decided pages map to those.

## Architecture

```
Login → POST :4001/api/auth/login → opaque tok_* in localStorage
        ↓
auth middleware → GET /api/auth/me (async session check)
        ↓
AppShellClient boot (Heron) → setEnabled/setTokenProvider from app.config.ts
        ↓
authorization middleware → $egret.auth.ensurePermissionsLoaded(principalKey)
        ↓
Heron GET /api/auth/permissions
   → permissions-loader.loadPermissions(token)   (I/O: fetch fake API grants)
   → permissions-adapter.adaptPermissions(raw)   (pure: grants → Heron rules)
        ↓
metadata / routes `can` + sidebar + Invite/Purge buttons
        ↓
Heron /api/widgets & /api/scripts
   → same loader+adapter, resolved once per request
   → Heron itself evaluates every `can` in-memory from those rules
     (no app-supplied "checkAccess" — one rule set, one evaluator,
     used identically by client and server)
```

| Piece | Path |
|---|---|
| Fake API server | [`fake-api/src/server.js`](fake-api/src/server.js) |
| JSON data (backend-native grants) | [`fake-api/data/`](fake-api/data/) |
| Permissions loader (I/O: fetch raw grants) | [`authorization/permissions-loader.ts`](authorization/permissions-loader.ts) |
| Permissions adapter (pure: grants → Heron rules) | [`authorization/permissions-adapter.ts`](authorization/permissions-adapter.ts) |
| Client middlewares | [`middlewares/auth.ts`](middlewares/auth.ts), [`middlewares/authorization.ts`](middlewares/authorization.ts) |

The fake API never speaks Heron's `{ action, subject }` shape — it only knows
flat `"action:subject"` grant strings (or `"*"` for everything). The
**loader** fetches those raw grants; the **adapter** is a pure function that
maps them to Heron's shape. Swap the loader for a different backend transport
and the adapter (and everything downstream) doesn't change.

## Fake API endpoints

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/health` | — |
| `GET` | `/api/auth/personas` | — |
| `POST` | `/api/auth/login` | body `{ userId }` or `{ email, password }` |
| `GET` | `/api/auth/me` | Bearer |
| `POST` | `/api/auth/logout` | Bearer |
| `GET` | `/api/authorization/permissions` | Bearer → `{ grants: string[] }` (native format) |
| `GET` | `/api/users` | Bearer (`read:User` grant) |
| `GET` | `/api/roles` | Bearer |

There is no `/api/authorization/check` endpoint — Heron resolves this
caller's rules once (loader + adapter) and authorizes every `can` in-memory,
instead of asking the backend one check at a time.

Sessions are **in-memory** — restarting the fake API invalidates all tokens.

## Page access policy

The backend only ever grants **business permissions** — `read:User`,
`write:User`, `command:users.invite`, `command:users.purge`, or `*` for
everything. It has no concept of "pages" at all, and shouldn't: which pages
exist and which business permissions unlock them is the **app's** decision
(this bootstrap app, the consumer of Heron), made once in
[`app-manifest.json`](app-manifest.json) and widget metadata `can`
declarations — not something the backend has to know or keep in sync as UI
changes:

| Route / node | `can` | Why |
|---|---|---|
| `/dashboard` | *(none)* | Not an auth boundary — every signed-in persona sees it, including Viewer who has zero business grants. |
| `/users`, `@navUsers` | `{ any: [read:User, write:User, command:users.invite, command:users.purge] }` | Anyone who can do **something** to a `User` gets into the page — the specific business action, not a page grant, is the real permission. |
| `purge-btn` (`@purgeBtn`) | `{ action: "command", subject: "users.purge" }` | Only visible to whoever holds this exact command permission — currently only Admin, via the wildcard. |
| `invite-btn` (`@inviteBtn`) | `{ action: "command", subject: "users.invite" }` | Editor and Admin both hold this grant directly. |
| `/settings`, `@navSettings` | `{ action: "*", subject: "*" }` | Admin-only: `*`/`*` as a **check** means "has the full wildcard grant", not "has some rule" — see `compileRules` in `@heron-ws/component-api`. Editor's very real `read:User`/`write:User`/`command:users.invite` grants do **not** satisfy this check. |

This is the pattern to copy for a real backend: keep your backend's
permission vocabulary strictly business-shaped, and let the app that
actually renders the pages decide the (page ↔ permission) mapping.

## Row-level conditions demo (Dashboard → "Team Tasks")

The Dashboard renders a shared "Team Tasks" list (`GET /api/tasks`, 5 rows,
one `assigneeId` each) to demonstrate `AuthorizationRule.conditions` —
per-row restrictions, not just per-page ones:

| Grant (backend, static per role) | Adapted rule (per caller) |
|---|---|
| admin: `*` | `{ action: "*", subject: "*" }` → sees all 5 rows |
| editor: `read:Task` | `{ action: "read", subject: "Task" }` (no conditions) → sees all 5 rows |
| viewer / viewer2: `read:Task:own` | `{ action: "read", subject: "Task", conditions: { assigneeId: "<caller's own id>" } }` → sees only their 1 row |

**Vic Viewer and Val Viewer hold the exact same static role grant**
(`read:Task:own`) — there's no per-user entry anywhere in
`fake-api/data/permissions.json`. What differs is `permissions-adapter.ts`
resolving `:own` using `raw.userId` (the caller's own id, returned by the
fake API from the Bearer token — see `permissions-loader.ts`), so the SAME
grant becomes a DIFFERENT `conditions.assigneeId` for each of them. Log in
as each and compare what "Team Tasks" shows.

`widgets/pages/dashboard/script.ts` reads this with
`$egret.auth.getPermission("read", "Task")` — **not** `can()` — to get the
raw rule (including its `conditions`, whatever shape they happen to be) and
decide for itself how to filter the list:

```ts
const rule = $egret.auth.getPermission("read", "Task");
// admin/editor -> conditions == null      -> show everything
// viewer(s)    -> conditions == {assigneeId} -> filter tasks by it
```

This is the general escape hatch for anything `can()`'s automatic
plain-object matching can't (or shouldn't) handle on its own — see
`getPermission`/`getPermissions` and `conditions` in
`docs/authorization.md` (heron repo) for the full contract.

## Run

```bash
# One-time: install fake-api deps (Express lives under fake-api/)
cd fake-api && npm install && cd ..

# From heron: build packages bootstrap links to (once / after heron changes)
cd ../heron && pnpm --filter @heron-ws/component-api --filter @heron-ws/page-engine --filter @heron-ws/app-runtime --filter @heron-ws/app-runtime-server build

cd ../bootstrap_app
pnpm install
pnpm dev
```

Opens:
- App: http://localhost:5174/login
- Fake API: http://localhost:4001/api/health

`pnpm dev` starts **fake-api + egret-dev-api + widget watch** together.

Env (`.env.local`):

```
EGRET_FAKE_API_URL=http://localhost:4001
```

Use **Switch role** in the header to re-login as another persona (new token from the API).
