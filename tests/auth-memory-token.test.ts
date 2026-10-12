import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import authAdapter from "../authorization/auth-adapter.ts";
import usersScript from "../widgets/pages/users/script.ts";

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return calls;
}

function bearerOf(call: FetchCall): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)
    ?.Authorization;
}

function fakeHeron(tokens: Array<string | null>) {
  const state = { clears: 0, issued: [] as Array<string | null> };
  let current: string | null = null;
  const heron = {
    getEnv: () => "http://api.test",
    auth: {
      async getAccessToken() {
        if (current === null) current = tokens.shift() ?? null;
        state.issued.push(current);
        return current;
      },
      clearAccessToken() {
        state.clears += 1;
        current = null;
      },
      can: () => false,
    },
  };
  return { heron, state };
}

function fakeSelf() {
  const texts: string[] = [];
  const child = {
    setProps: (props: { text?: string }) => {
      if (typeof props.text === "string") texts.push(props.text);
    },
    listen: () => {},
  };
  return { self: { getProps: () => ({}), getChild: () => child }, texts };
}

async function settle(predicate: () => boolean) {
  for (let i = 0; i < 50 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a backend 401 clears the memory token, restores once, and retries once", async () => {
  const calls = mockFetch([
    { status: 401, body: { success: false } },
    { status: 200, body: { success: true, data: [{ name: "Ada" }] } },
  ]);
  const { heron, state } = fakeHeron(["stale", "fresh"]);
  const { self, texts } = fakeSelf();

  usersScript(heron, self);
  await settle(() => texts.some((t) => t.startsWith("Loaded")));

  const api = calls.filter((c) => c.url.endsWith("/api/users"));
  assert.equal(api.length, 2);
  assert.equal(bearerOf(api[0]), "Bearer stale");
  assert.equal(bearerOf(api[1]), "Bearer fresh");
  assert.equal(state.clears, 1);
});

test("a second 401 stops instead of looping", async () => {
  const calls = mockFetch([
    { status: 401, body: { success: false } },
    { status: 401, body: { success: false } },
  ]);
  const { heron, state } = fakeHeron(["stale", "also-stale", "never-used"]);
  const { self, texts } = fakeSelf();

  usersScript(heron, self);
  await settle(() => texts.some((t) => t.startsWith("Failed")));

  assert.equal(calls.filter((c) => c.url.endsWith("/api/users")).length, 2);
  assert.equal(state.clears, 1);
  assert.ok(texts.includes("Failed to load users (401)."));
});

test("non-auth errors are not retried", async () => {
  const calls = mockFetch([{ status: 403, body: { success: false } }]);
  const { heron, state } = fakeHeron(["token"]);
  const { self, texts } = fakeSelf();

  usersScript(heron, self);
  await settle(() => texts.some((t) => t.startsWith("Forbidden")));

  assert.equal(calls.filter((c) => c.url.endsWith("/api/users")).length, 1);
  assert.equal(state.clears, 0);
});

test("adapter login returns only the access credential and browser-safe principal", async () => {
  const expiresAt = Date.now() + 30 * 60_000;
  mockFetch([
    {
      status: 200,
      body: {
        success: true,
        data: {
          accessToken: "tok_1",
          expiresAt,
          user: { id: "admin", name: "Ada Admin", role: "admin" },
        },
      },
    },
  ]);
  const result = await authAdapter.authenticate!({ userId: "admin" }, {
    now: Date.now(),
  } as any);
  assert.deepEqual(result, {
    credential: "tok_1",
    principal: { key: "admin", id: "admin", name: "Ada Admin", role: "admin" },
    expiresAt,
  });
});

test("adapter logout revokes the backend session", async () => {
  const calls = mockFetch([{ status: 200, body: { success: true } }]);
  await authAdapter.revoke!("tok_1", { now: Date.now() } as any);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/auth\/logout$/);
  assert.equal(bearerOf(calls[0]), "Bearer tok_1");
});

test("app code never persists an auth credential in browser storage", async () => {
  const files = [
    "../app.config.ts",
    "../middlewares/auth.ts",
    "../widgets/pages/login/script.ts",
    "../widgets/pages/users/script.ts",
    "../widgets/pages/dashboard/script.ts",
    "../widgets/shell/app-header/script.ts",
    "../widgets/shell/sidebar-menu/script.ts",
  ];
  for (const relative of files) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /(localStorage|sessionStorage)\.(setItem|getItem)\(\s*["'`]auth_token/,
      relative,
    );
  }
  const config = await readFile(
    new URL("../app.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /browserToken:\s*"memory"/);
});
