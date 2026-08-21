/**
 * Fake backend for Bootstrap App — Express, JSON data, no DB.
 *
 * Everything here speaks the backend's OWN native permission format — a flat
 * list of "action:subject" grant strings (or "*"). This API knows nothing
 * about Heron. Translation to/from Heron's { action, subject } rule shape
 * lives entirely in the app's authorization/permissions-adapter.ts.
 *
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/auth/personas
 *   POST /api/auth/login          { userId } | { email, password }
 *   GET  /api/auth/me             Bearer
 *   POST /api/auth/logout         Bearer
 *   GET  /api/authorization/permissions   Bearer → { userId, roleId, grants: string[] } (native format)
 *   GET  /api/users               Bearer (needs "read:User" or "*")
 *   GET  /api/roles               Bearer
 *   GET  /api/tasks                Bearer (enforces read:Task / own rows)
 *
 * Note: there is no "/api/authorization/check" endpoint. Heron's server
 * resolves a caller's rules ONCE per request via
 * authorization/permissions-loader.ts + permissions-adapter.ts (in the app,
 * not here), then authorizes every `can` in-memory from that single rule
 * set — this fake API is never asked "can this user do X" one check at a
 * time.
 */
import express from "express";
import cors from "cors";
import {
  listPersonas,
  findUserById,
  findUserByCredentials,
  publicUser,
  createSession,
  destroySession,
  identityFromToken,
  grantsForUser,
  hasGrant,
  updateUserProfile,
  listTeamMembers,
  listRoles,
  listTasks,
  delay,
} from "./store.js";

const PORT = Number(process.env.FAKE_API_PORT ?? 4001);
const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

function bearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

function requireAuth(req, res, next) {
  const token = bearer(req);
  const identity = identityFromToken(token);
  if (!identity) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  req.user = identity.user;
  req.token = token;
  req.authExpiresAt = identity.expiresAt;
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "bootstrap-fake-api" });
});

app.get("/api/auth/personas", async (_req, res) => {
  await delay();
  res.json({ success: true, data: listPersonas() });
});

app.post("/api/auth/login", async (req, res) => {
  await delay(180);
  const body = req.body ?? {};
  let user = null;

  if (typeof body.userId === "string") {
    user = findUserById(body.userId);
  } else if (
    typeof body.email === "string" &&
    typeof body.password === "string"
  ) {
    user = findUserByCredentials(body.email, body.password);
  }

  if (!user) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  const { accessToken, expiresAt } = createSession(user.id);
  res.json({
    success: true,
    data: {
      accessToken,
      expiresAt,
      user: publicUser(user),
    },
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  await delay();
  res.json({
    success: true,
    data: {
      ...publicUser(req.user),
      expiresAt: req.authExpiresAt,
    },
  });
});

app.patch("/api/auth/me", requireAuth, async (req, res) => {
  await delay();
  const updated = updateUserProfile(req.user, {
    name: req.body?.name,
  });
  res.json({
    success: true,
    data: {
      ...updated,
      expiresAt: req.authExpiresAt,
    },
  });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await delay(60);
  destroySession(req.token);
  res.json({ success: true });
});

app.get("/api/authorization/permissions", requireAuth, async (req, res) => {
  await delay();
  res.json({
    success: true,
    data: {
      userId: req.user.id,
      roleId: req.user.roleId,
      grants: grantsForUser(req.user),
    },
  });
});

app.get("/api/users", requireAuth, async (req, res) => {
  await delay();
  if (!hasGrant(req.user, "read:User")) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }
  res.json({ success: true, data: listTeamMembers() });
});

app.get("/api/roles", requireAuth, async (req, res) => {
  await delay();
  res.json({ success: true, data: listRoles() });
});

// The backend enforces the same row boundary as the Heron adapter. Client-side
// filtering remains useful UX, but is never the data-protection boundary.
app.get("/api/tasks", requireAuth, async (req, res) => {
  await delay();
  if (hasGrant(req.user, "read:Task")) {
    res.json({ success: true, data: listTasks() });
    return;
  }
  if (hasGrant(req.user, "read:Task:own")) {
    res.json({
      success: true,
      data: listTasks().filter((task) => task.assigneeId === req.user.id),
    });
    return;
  }
  res.status(403).json({ success: false, error: "Forbidden" });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

const server = app.listen(PORT, () => {
  console.log(`[fake-api] http://localhost:${PORT}`);
  console.log(`[fake-api] personas: GET /api/auth/personas`);
  console.log(
    `[fake-api] login:    POST /api/auth/login { "userId": "admin" }`,
  );
});

server.on("error", (err) => {
  console.error(`[fake-api] ${err.message}`);
  process.exit(1);
});
