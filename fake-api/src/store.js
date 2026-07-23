/**
 * JSON-backed store for the fake API (no database).
 * Sessions live in memory; restart clears tokens.
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
 * Demo rows for the row-level "conditions" example: each task has an
 * `assigneeId`. This endpoint returns ALL tasks to ANY authenticated user —
 * filtering to "only my rows" is deliberately left to Heron's client-side
 * `read:Task` rule + `conditions` (see permissions.json's "read:Task:own"
 * grant and authorization/permissions-adapter.ts), not this fake backend. A
 * real backend must still re-check this server-side; this demo only shows
 * the client-side half.
 * @type {Array<{id:string,title:string,assigneeId:string,assigneeName:string,status:string}>}
 */
const tasks = readJson("tasks.json");

/** @type {Map<string, { userId: string, createdAt: number }>} */
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
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

export function userFromToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return findUserById(session.userId);
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
