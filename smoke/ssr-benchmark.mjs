/**
 * V9 browser/server benchmark. Provide deployments or feature-flagged URLs:
 *
 * HERON_BENCHMARK_VARIANTS='[
 *   {"name":"csr","url":"http://localhost:3001/login"},
 *   {"name":"core-ssr","url":"http://localhost:3000/login"},
 *   {"name":"universal","url":"http://localhost:3100/dev/registry-widget-demo"},
 *   {"name":"loaders","url":"http://localhost:3000/dashboard"},
 *   {"name":"streaming","url":"http://localhost:3000/login"}
 * ]' pnpm benchmark:ssr
 *
 * Optional per-variant `headers` support authenticated/private test systems.
 * Do not paste production credentials into committed scripts or result files.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const variants = JSON.parse(
  process.env.HERON_BENCHMARK_VARIANTS ??
    '[{"name":"streaming-core","url":"http://localhost:3000/login"}]',
);
const samples = Math.max(1, Number(process.env.HERON_BENCHMARK_SAMPLES ?? 5));
const chromePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));
if (!chromePath) throw new Error("Chrome/Chromium not found; set CHROME_PATH");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== method) return;
        this.listeners.delete(listener);
        resolve(message.params);
      };
      this.listeners.add(listener);
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "heron-benchmark-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ]);
  const portFile = join(profile, "DevToolsActivePort");
  const [port] = await waitFor(() => {
    if (!existsSync(portFile)) return null;
    return readFileSync(portFile, "utf8").trim().split("\n");
  }, "Chrome debugging port");
  const target = await waitFor(async () => {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) =>
      r.json(),
    );
    return list.find((entry) => entry.type === "page");
  }, "Chrome page target");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(socket);
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable"),
    cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        'globalThis.__heronLcp=0;new PerformanceObserver(l=>{for(const e of l.getEntries())globalThis.__heronLcp=e.startTime}).observe({type:"largest-contentful-paint",buffered:true});',
    }),
  ]);
  return {
    cdp,
    async close() {
      socket.close();
      chrome.kill("SIGTERM");
      await delay(100);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function sample(cdp, variant, cold) {
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: cold });
  await cdp.send("Network.setExtraHTTPHeaders", {
    headers: variant.headers ?? {},
  });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: variant.url });
  await loaded;
  await delay(750);
  return cdp.evaluate(`(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      ttfb: n ? n.responseStart - n.requestStart : 0,
      fcp: fcp?.startTime ?? 0,
      lcp: globalThis.__heronLcp ?? 0,
      responseBytes: n?.encodedBodySize ?? 0,
      transferBytes: n?.transferSize ?? 0,
      serverTiming: Object.fromEntries((n?.serverTiming ?? []).map(e => [e.name, e.duration])),
      cache: n ? "navigation" : "missing"
    };
  })()`);
}

const browser = await launch();
try {
  const report = [];
  for (const variant of variants) {
    for (const mode of ["cold", "warm"]) {
      const rows = [];
      for (let index = 0; index < samples; index++) {
        rows.push(await sample(browser.cdp, variant, mode === "cold"));
      }
      report.push({
        variant: variant.name,
        mode,
        samples,
        medianTtfbMs: median(rows.map((row) => row.ttfb)),
        medianFcpMs: median(rows.map((row) => row.fcp)),
        medianLcpMs: median(rows.map((row) => row.lcp)),
        medianResponseBytes: median(rows.map((row) => row.responseBytes)),
        medianServerPrepareMs: median(
          rows.map((row) => row.serverTiming["heron-prepare"] ?? 0),
        ),
        medianServerShellMs: median(
          rows.map((row) => row.serverTiming["heron-shell"] ?? 0),
        ),
      });
    }
  }
  console.table(report);
  console.log(
    JSON.stringify({ measuredAt: new Date().toISOString(), report }, null, 2),
  );
} finally {
  await browser.close();
}
