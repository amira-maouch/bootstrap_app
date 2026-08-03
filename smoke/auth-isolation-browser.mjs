/**
 * V6.5 + V8 browser smoke — authenticated-session isolation and SSR loader reuse.
 *
 * Signs in as two DIFFERENT fake-api personas ("viewer" and "viewer2", same
 * role, different identity/assigned task — see fake-api/data/{users,tasks}.json)
 * in two fully independent headless Chrome profiles (separate processes,
 * separate cookie jars), then requests the protected `/dashboard` route for
 * both *concurrently*, with the page's own JavaScript disabled, to prove:
 *
 *   - each session's SSR HTML contains ONLY that session's permitted task
 *     data (server-side, real content — not a client-script paint)
 *   - neither session's HTML ever contains the other session's identity or
 *     task data (no request-scope leakage between concurrent requests)
 *   - the personalized document response is Cache-Control: private, no-store
 *   - the inlined bootstrap JSON carries no raw token / cookie / session id
 *   - after re-enabling JavaScript, the same loader props hydrate and the
 *     dashboard script performs no duplicate initial `/api/tasks` fetch
 *
 * Run with the fake API + bootstrap_app SSR server already running:
 *   pnpm dev   (in one terminal)
 *   pnpm smoke:ssr-loader                     (in another)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = (
  process.env.HERON_SMOKE_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);

if (!chromePath) {
  throw new Error(
    "Chrome/Chromium was not found. Set CHROME_PATH to its executable.",
  );
}
if (typeof WebSocket !== "function") {
  throw new Error("This smoke test requires Node 22+ for the WebSocket API.");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForValue(read, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      lastValue = value;
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}${
      lastError ? `: ${String(lastError)}` : ""
    }${lastValue !== undefined ? `; last value: ${JSON.stringify(lastValue)}` : ""}`,
  );
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error(`Could not connect to ${url}`)),
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression, awaitPromise = true) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Evaluation failed");
  }
  return response.result?.value;
}

/** Launch one fully independent headless Chrome session (own process, own cookie jar). */
async function launchSession(label) {
  const profileDir = mkdtempSync(join(tmpdir(), `heron-auth-iso-${label}-`));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  chrome.stderr.on("data", (chunk) => (stderr += String(chunk)));

  const activePortFile = join(profileDir, "DevToolsActivePort");
  const [debugPort] = await waitForValue(() => {
    if (!existsSync(activePortFile)) return null;
    const lines = readFileSync(activePortFile, "utf8").trim().split("\n");
    return lines[0] ? lines : null;
  }, `${label} Chrome DevTools port`);

  const target = await waitForValue(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find((entry) => entry.type === "page") ?? null;
  }, `${label} Chrome page target`);

  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([
    client.send("Runtime.enable"),
    client.send("Page.enable"),
    client.send("Network.enable"),
  ]);

  const responseHeaders = new Map();
  const requests = [];
  client.onEvent((message) => {
    if (message.method === "Network.requestWillBeSent") {
      requests.push(message.params.request.url);
    }
    if (message.method === "Network.responseReceived") {
      responseHeaders.set(message.params.response.url, message.params.response.headers);
    }
  });

  return {
    label,
    client,
    chrome,
    profileDir,
    responseHeaders,
    requests,
    clearRequests() {
      requests.splice(0);
    },
    getStderr: () => stderr,
    async close() {
      client.close();
      if (chrome.exitCode === null) {
        const exited = new Promise((resolve) => chrome.once("exit", resolve));
        chrome.kill("SIGTERM");
        await Promise.race([exited, delay(2_000)]);
      }
      try {
        rmSync(profileDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      } catch (error) {
        console.warn(
          `[${label}] could not remove temporary Chrome profile ${profileDir}:`,
          error,
        );
      }
    },
  };
}

/** Sign in as `userId` via the same-origin session endpoint (JS enabled). */
async function signIn(session, userId) {
  await session.client.send("Page.navigate", { url: `${baseUrl}/login` });
  await waitForValue(
    () => evaluate(session.client, `location.pathname === "/login"`),
    `${session.label} to load /login`,
  );
  const result = await evaluate(
    session.client,
    `fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ userId: ${JSON.stringify(userId)} }),
    }).then(r => r.json())`,
  );
  if (!result?.success) {
    throw new Error(
      `${session.label} sign-in as ${userId} failed: ${JSON.stringify(result)}`,
    );
  }
  if (typeof result.data?.browserToken === "string") {
    await evaluate(
      session.client,
      `localStorage.setItem("auth_token", ${JSON.stringify(result.data.browserToken)})`,
    );
  }
  return result.data;
}

async function main() {
  // viewer/viewer2 share a role but each has exactly one assigned task —
  // see fake-api/data/tasks.json. This is the concrete leak signal: viewer's
  // page must show "Update onboarding checklist" and never "Val Viewer" /
  // "Audit inactive accounts", and vice versa for viewer2.
  const PERSONAS = {
    viewer: { ownTask: "Update onboarding checklist", otherName: "Val Viewer", otherTask: "Audit inactive accounts" },
    viewer2: { ownTask: "Audit inactive accounts", otherName: "Vic Viewer", otherTask: "Update onboarding checklist" },
  };

  const sessions = { viewer: await launchSession("viewer"), viewer2: await launchSession("viewer2") };

  try {
    for (const [userId, session] of Object.entries(sessions)) {
      await signIn(session, userId);
      // From here on this profile only ever renders with the page's own
      // JavaScript OFF — proving the content below is real SSR HTML, not a
      // post-hydration script paint.
      await session.client.send("Emulation.setScriptExecutionDisabled", {
        value: true,
      });
    }

    // The concurrency proof: both protected requests hit the SSR server at
    // the same time, from different authenticated sessions.
    await Promise.all(
      Object.values(sessions).map((session) =>
        session.client.send("Page.navigate", { url: `${baseUrl}/dashboard` }),
      ),
    );

    const pageStates = {};
    for (const [userId, session] of Object.entries(sessions)) {
      pageStates[userId] = await waitForValue(async () => {
        const state = await evaluate(
          session.client,
          `(() => ({
            pathname: location.pathname,
            hasBootstrap: !!document.getElementById("HERON_BOOTSTRAP"),
            bootstrapText: document.getElementById("HERON_BOOTSTRAP")?.textContent ?? "",
            bodyText: document.body?.textContent ?? ""
          }))()`,
          false,
        );
        return state.pathname === "/dashboard" && state.hasBootstrap ? state : null;
      }, `${userId} SSR /dashboard response`);
    }

    for (const [userId, state] of Object.entries(pageStates)) {
      const persona = PERSONAS[userId];

      if (!state.bodyText.includes(persona.ownTask)) {
        throw new Error(
          `${userId}'s SSR HTML (JS disabled) is missing its own task "${persona.ownTask}"`,
        );
      }
      if (state.bodyText.includes(persona.otherTask) || state.bodyText.includes(persona.otherName)) {
        throw new Error(
          `${userId}'s SSR HTML leaked the other session's data (found "${persona.otherTask}" or "${persona.otherName}")`,
        );
      }
      if (/"token"\s*:|browserToken|sessionId/i.test(state.bootstrapText)) {
        throw new Error(
          `${userId}'s bootstrap JSON appears to contain a raw token/session id: ${state.bootstrapText}`,
        );
      }

      const headers = sessions[userId].responseHeaders.get(`${baseUrl}/dashboard`) ?? {};
      const cacheControl = Object.entries(headers).find(
        ([key]) => key.toLowerCase() === "cache-control",
      )?.[1];
      if (cacheControl !== "private, no-store") {
        throw new Error(
          `${userId}'s /dashboard response had Cache-Control: ${cacheControl}, expected "private, no-store"`,
        );
      }
    }

    // V8 proof: use one of the same authenticated sessions for a fresh
    // JavaScript-enabled document load. The server loader still supplies the
    // task data, hydration adopts it, and the widget script must reuse those
    // props instead of calling the fake API from the browser.
    const hydrationSession = sessions.viewer;
    await hydrationSession.client.send("Emulation.setScriptExecutionDisabled", {
      value: false,
    });
    hydrationSession.clearRequests();
    await hydrationSession.client.send("Page.navigate", {
      url: `${baseUrl}/dashboard`,
    });

    let lastHydratedDashboardState;
    let hydrated;
    try {
      hydrated = await waitForValue(async () => {
        const state = await evaluate(
          hydrationSession.client,
          `(() => {
          const payloadText = document.getElementById("HERON_BOOTSTRAP")?.textContent ?? "";
          const payload = payloadText ? JSON.parse(payloadText) : null;
          const dashboardNode = payload
            ? Object.values(payload.nodes ?? {}).find(node => node?.widgetPackageName === "pages/dashboard")
            : null;
          return {
            pathname: location.pathname,
            hydration: window.__HERON_HYDRATION__ ?? null,
            bodyText: document.body?.textContent ?? "",
            loaderProvenance: dashboardNode?.props?.__egretLoader ?? null
          };
        })()`,
        );
        lastHydratedDashboardState = state;
        return state.pathname === "/dashboard" &&
          state.hydration?.status === "hydrated" &&
          state.bodyText.includes("restricted by conditions")
          ? state
          : null;
      }, "the loader-backed dashboard to hydrate and run its widget script");
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; dashboard state: ${JSON.stringify(lastHydratedDashboardState)}`,
      );
    }

    if (
      hydrated.loaderProvenance?.source !== "server-loader" ||
      !hydrated.loaderProvenance?.keys?.includes("tasks")
    ) {
      throw new Error(
        `Dashboard bootstrap did not expose loader provenance: ${JSON.stringify(hydrated.loaderProvenance)}`,
      );
    }

    const duplicateTaskRequests = hydrationSession.requests.filter((requestUrl) => {
      try {
        return new URL(requestUrl).pathname === "/api/tasks";
      } catch {
        return false;
      }
    });
    if (duplicateTaskRequests.length > 0) {
      throw new Error(
        `Hydrated dashboard repeated its initial task fetch in the browser: ${duplicateTaskRequests.join(", ")}`,
      );
    }

    console.log("V6.5 auth isolation + V8 SSR loader browser smoke passed");
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(pageStates).map(([userId, state]) => [
            userId,
            { sawOwnTask: true, hasBootstrap: state.hasBootstrap },
          ]),
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    for (const session of Object.values(sessions)) {
      const stderr = session.getStderr();
      if (stderr) console.error(`[${session.label} chrome stderr]`, stderr.trim());
    }
    throw error;
  } finally {
    await Promise.all(Object.values(sessions).map((session) => session.close()));
  }
}

await main();
