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

const profileDir = mkdtempSync(join(tmpdir(), "heron-hydration-smoke-"));
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

let chromeStderr = "";
chrome.stderr.on("data", (chunk) => {
  chromeStderr += String(chunk);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForValue(read, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}${
      lastError ? `: ${String(lastError)}` : ""
    }`,
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

function stringifyConsoleArgument(argument) {
  if (typeof argument.value === "string") return argument.value;
  if (argument.value !== undefined) return JSON.stringify(argument.value);
  return argument.description ?? "";
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Evaluation failed");
  }
  return response.result?.value;
}

let client;
let boundarySmoke;
try {
  const activePortFile = join(profileDir, "DevToolsActivePort");
  const [debugPort] = await waitForValue(() => {
    if (!existsSync(activePortFile)) return null;
    const lines = readFileSync(activePortFile, "utf8").trim().split("\n");
    return lines[0] ? lines : null;
  }, "Chrome DevTools port");

  const target = await waitForValue(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find((entry) => entry.type === "page") ?? null;
  }, "Chrome page target");

  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([
    client.send("Runtime.enable"),
    client.send("Page.enable"),
    client.send("Network.enable"),
    client.send("Log.enable"),
  ]);

  let requests = [];
  let consoleFailures = [];
  let exceptions = [];
  client.onEvent((message) => {
    if (message.method === "Network.requestWillBeSent") {
      requests.push(message.params.request.url);
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(
        message.params.exceptionDetails?.exception?.description ??
          message.params.exceptionDetails?.text ??
          "Uncaught browser exception",
      );
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const type = message.params.type;
      const text = message.params.args.map(stringifyConsoleArgument).join(" ");
      if (
        (type === "error" || type === "warning") &&
        /hydration|did not match|server rendered html|recoverable/i.test(text)
      ) {
        consoleFailures.push(text);
      }
    }
  });

  // V6.5 proof: /dashboard is now a PROTECTED SSR route, not a CSR-only one.
  // An unauthenticated request must never reach protected HTML/bootstrap data
  // at all — the server issues a 302 to /login?returnTo=%2Fdashboard *before*
  // any page-tree resolution runs, and that redirect target is itself an SSR
  // route, so it arrives already hydrated (unlike the old CSR-fallback world
  // this test used to assume, where /dashboard mounted client-side first and
  // only then redirected after its own auth check).
  await client.send("Page.navigate", { url: `${baseUrl}/dashboard` });
  const redirected = await waitForValue(async () => {
    const state = await evaluate(
      client,
      `(() => ({
          pathname: location.pathname,
          search: location.search,
          hasBootstrap: !!document.getElementById("HERON_BOOTSTRAP"),
          hydration: window.__HERON_HYDRATION__ ?? null,
          rootText: document.getElementById("root")?.textContent ?? ""
        }))()`,
    );
    return state.pathname === "/login" &&
      (state.hydration?.status === "hydrated" ||
        state.hydration?.status === "mismatch")
      ? state
      : null;
  }, "the protected route to redirect and the login destination to hydrate");
  if (redirected.search !== "?returnTo=%2Fdashboard") {
    throw new Error(
      `Expected the safe returnTo redirect target, got search=${redirected.search}`,
    );
  }
  if (!redirected.hasBootstrap || redirected.hydration?.status !== "hydrated") {
    throw new Error(
      `Redirected /login destination did not hydrate cleanly: ${JSON.stringify(
        redirected.hydration,
      )}`,
    );
  }
  if (!redirected.rootText.includes("Bootstrap App")) {
    throw new Error(
      "Redirected /login document lost its server-rendered content.",
    );
  }
  // The redirect must happen before any protected resolution — no page-tree
  // fetch for /dashboard's data should ever have been requested.
  const protectedTreeRequests = requests.filter((url) =>
    url.includes("/api/widgets/"),
  );
  if (protectedTreeRequests.length > 0) {
    throw new Error(
      `Unauthenticated request triggered a protected page-tree fetch before redirecting: ${protectedTreeRequests.join(", ")}`,
    );
  }

  // Reset observations, then force a new document request to the allowlisted
  // route. This must hydrate the server tree without fetching it again.
  requests = [];
  consoleFailures = [];
  exceptions = [];
  await client.send("Page.navigate", { url: `${baseUrl}/login` });
  const ssr = await waitForValue(async () => {
    const state = await evaluate(
      client,
      `(() => ({
          pathname: location.pathname,
          hasBootstrap: !!document.getElementById("HERON_BOOTSTRAP"),
          hydration: window.__HERON_HYDRATION__ ?? null,
          rootText: document.getElementById("root")?.textContent ?? ""
        }))()`,
    );
    return state.hydration?.status === "hydrated" ||
      state.hydration?.status === "mismatch"
      ? state
      : null;
  }, "the SSR route to finish hydration");

  const hydrationErrors = ssr.hydration?.errors ?? [];
  if (!ssr.hasBootstrap) {
    throw new Error("SSR /login document had no HERON_BOOTSTRAP payload.");
  }
  if (ssr.hydration?.status !== "hydrated") {
    throw new Error(
      `Hydration status was ${ssr.hydration?.status}: ${JSON.stringify(
        hydrationErrors,
      )}`,
    );
  }
  if (hydrationErrors.length > 0 || consoleFailures.length > 0) {
    throw new Error(
      `Hydration warnings were detected: ${JSON.stringify([
        ...hydrationErrors,
        ...consoleFailures,
      ])}`,
    );
  }
  if (exceptions.length > 0) {
    throw new Error(
      `Browser exceptions were detected: ${JSON.stringify(exceptions)}`,
    );
  }
  if (!ssr.rootText.includes("Bootstrap App")) {
    throw new Error("Hydrated root lost the server-rendered login content.");
  }

  const duplicateTreeFetches = requests.filter((url) =>
    url.includes("/api/widgets/"),
  );
  if (duplicateTreeFetches.length > 0) {
    throw new Error(
      `SSR hydration repeated the page-tree fetch: ${duplicateTreeFetches.join(
        ", ",
      )}`,
    );
  }

  const widgetScriptRequests = requests.filter((url) =>
    url.includes("/api/scripts/"),
  );
  const scriptRequestCounts = new Map();
  for (const url of widgetScriptRequests) {
    scriptRequestCounts.set(url, (scriptRequestCounts.get(url) ?? 0) + 1);
  }
  const duplicateScripts = [...scriptRequestCounts].filter(
    ([, count]) => count > 1,
  );
  if (duplicateScripts.length > 0) {
    throw new Error(
      `Widget scripts were requested more than once: ${JSON.stringify(
        duplicateScripts,
      )}`,
    );
  }

  // V7 proof: authenticate, then hydrate the nested boundary matrix. The
  // universal avatar must be adopted from SSR, while the browser-only badge
  // and client-only widget subtrees mount after the hydration boundary phase.
  const login = await evaluate(
    client,
    `fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ userId: "admin" })
    }).then(r => r.json())`,
  );
  if (!login?.success || typeof login.data?.browserToken !== "string") {
    throw new Error(
      `Could not create the boundary smoke session: ${JSON.stringify(login)}`,
    );
  }
  await evaluate(
    client,
    `localStorage.setItem("auth_token", ${JSON.stringify(login.data.browserToken)})`,
  );

  requests = [];
  consoleFailures = [];
  exceptions = [];
  await client.send("Page.navigate", { url: `${baseUrl}/ssr-boundaries` });
  boundarySmoke = await waitForValue(async () => {
    const state = await evaluate(
      client,
      `(() => {
          const bootstrapElement = document.getElementById("HERON_BOOTSTRAP");
          const bootstrap = bootstrapElement
            ? JSON.parse(bootstrapElement.textContent || "null")
            : null;
          const componentModes = Object.values(bootstrap?.components || {});
          return {
            pathname: location.pathname,
            hydration: window.__HERON_HYDRATION__ ?? null,
            rootText: document.getElementById("root")?.textContent ?? "",
            avatarVisible: !!document.querySelector('[aria-label="Ada Lovelace"]'),
            avatarMode: componentModes.find(x => x.component === "ui:display:avatar")?.renderMode,
            badgeMode: componentModes.find(x => x.component === "ui:display:badge")?.renderMode,
            componentBundles: bootstrap?.componentBundles ?? null
          };
        })()`,
    );
    const mounted =
      state.rootText.includes("Browser-only badge") &&
      state.rootText.includes("Case 3 — client-only widget");
    return mounted &&
      (state.hydration?.status === "hydrated" ||
        state.hydration?.status === "mismatch")
      ? state
      : null;
  }, "the universal/client-only boundary matrix to hydrate and mount");

  if (boundarySmoke.hydration?.status !== "hydrated") {
    throw new Error(
      `Boundary route hydration failed: ${JSON.stringify(boundarySmoke.hydration)}`,
    );
  }
  if (
    !boundarySmoke.avatarVisible ||
    boundarySmoke.avatarMode !== "universal"
  ) {
    throw new Error(
      `Universal avatar was not preserved: ${JSON.stringify(boundarySmoke)}`,
    );
  }
  if (boundarySmoke.badgeMode !== "client-only") {
    throw new Error(
      `Browser-only badge did not use a client boundary: ${JSON.stringify(boundarySmoke)}`,
    );
  }
  if (
    boundarySmoke.componentBundles?.["ui/components/display/avatar"] !== "1.0.0"
  ) {
    throw new Error(
      `Universal avatar version was not pinned for hydration: ${JSON.stringify(boundarySmoke.componentBundles)}`,
    );
  }
  if (consoleFailures.length > 0 || exceptions.length > 0) {
    throw new Error(
      `Boundary route browser errors: ${JSON.stringify([
        ...consoleFailures,
        ...exceptions,
      ])}`,
    );
  }

  const boundaryComponentRequests = requests.filter((url) =>
    url.includes("/api/components"),
  );

  console.log("V5/V6.5/V7 browser smoke passed");
  console.log(
    JSON.stringify(
      {
        protectedRedirect: {
          initialUrl: "/dashboard",
          finalUrl: `${redirected.pathname}${redirected.search}`,
          protectedPageTreeRequests: protectedTreeRequests.length,
          hydrationState: redirected.hydration,
        },
        ssr: {
          url: ssr.pathname,
          status: ssr.hydration.status,
          recoverableErrors: hydrationErrors.length,
          duplicatePageTreeRequests: duplicateTreeFetches.length,
          widgetScriptRequests: widgetScriptRequests.length,
        },
        boundaries: {
          url: boundarySmoke.pathname,
          status: boundarySmoke.hydration.status,
          avatarMode: boundarySmoke.avatarMode,
          badgeMode: boundarySmoke.badgeMode,
          componentBundles: boundarySmoke.componentBundles,
          componentRequests: boundaryComponentRequests.length,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (chromeStderr) {
    console.error(chromeStderr.trim());
  }
  throw error;
} finally {
  client?.close();
  chrome.kill("SIGTERM");
  rmSync(profileDir, { recursive: true, force: true });
}
