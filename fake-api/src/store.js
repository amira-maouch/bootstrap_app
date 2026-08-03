/**
 * JSON-backed fake backend (no database). Authentication sessions belong to
 * this backend boundary; a production API would persist the same records in a
 * database or Redis. Restarting this demo API clears them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

function readJson(name) {
  const full = path.join(DATA_DIR, name);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

/** @type {Array<{id:string,name:string,email:string,initials:string,roleId:string,password:string}>} */
const users = readJson("users.json");
/** @type {Array<{id:string,name:string,description:string}>} */
const roles = readJson("roles.json");
/**
 * Backend-native permission format: a flat list of "action:subject" grant
 * strings per role, or "*" for everything. This is OUR format — it has
 * nothing to do with Heron. The Heron permissions adapter
 * (authorization/permissions-adapter.ts in the app) is the only place that
 * translates these into Heron's { action, subject } rule shape.
 * @type {Record<string, string[]>}
 */
const grantsByRole = readJson("permissions.json");
/** @type {Array<Record<string, unknown>>} */
const teamMembers = readJson("team-members.json");
/**
 * Demo rows for the row-level "conditions" example. The API filters these
 * server-side before returning them; Heron's matching client condition is a
 * UI projection, not a security boundary.
 * @type {Array<{id:string,title:string,assigneeId:string,assigneeName:string,status:string}>}
 */
const tasks = readJson("tasks.json");

const SESSION_LIFETIME_MS = 30 * 60 * 1000;

/** @type {Map<string, { userId: string, createdAt: number, expiresAt: number }>} */
const sessions = new Map();

export function listPersonas() {
  return users.map((u) => {
    const role = roles.find((r) => r.id === u.roleId);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      roleId: u.roleId,
      roleName: role?.name ?? u.roleId,
      description: role?.description ?? "",
    };
  });
}

export function findUserById(id) {
  return users.find((u) => u.id === id) ?? null;
}

export function findUserByCredentials(email, password) {
  return (
    users.find((u) => u.email === email && u.password === password) ?? null
  );
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    initials: user.initials,
    role: user.roleId,
    roleId: user.roleId,
  };
}

export function createSession(userId) {
  const token = `tok_${randomBytes(16).toString("hex")}`;
  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_LIFETIME_MS;
  sessions.set(token, { userId, createdAt, expiresAt });
  return { accessToken: token, expiresAt };
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

export function identityFromToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = findUserById(session.userId);
  return user ? { user, expiresAt: session.expiresAt } : null;
}

export function grantsForUser(user) {
  if (!user) return [];
  return grantsByRole[user.roleId] ?? [];
}

/** Does this user hold `grant` (or the "*" everything grant)? */
export function hasGrant(user, grant) {
  const grants = grantsForUser(user);
  return grants.includes("*") || grants.includes(grant);
}

export function listTeamMembers() {
  return teamMembers;
}

export function listTasks() {
  return tasks;
}

export function listRoles() {
  return roles;
}

/** Simulate network latency for a more realistic demo. */
export function delay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
