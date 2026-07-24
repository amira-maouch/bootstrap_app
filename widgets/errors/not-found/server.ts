/**
 * Server-side loader for the 404 widget.
 *
 * EDGE CASE DEMO: throw isolation + timeout protection.
 *
 * This loader is intentionally written to demonstrate the two "dangerous"
 * edge cases — an unhandled throw and a slow/hanging loader — without
 * actually breaking anything, because the runtime isolates failures per
 * widget via Promise.allSettled and a 3-second hard timeout.
 *
 * HOW TO TEST:
 *   Navigate to any unknown route (e.g. /does-not-exist) to trigger this
 *   widget. Then flip the constants below and watch the server log.
 *
 * Expected results in both cases:
 *   • The 404 page still renders (tree is served with static props).
 *   • Other widgets on the same page (root layout, sidebar, etc.) are
 *     unaffected — their loaders ran independently.
 *   • A single [egret] error line appears in the server log.
 *   • No HTTP 500 is returned to the browser.
 */
import type { ServerContext } from "@heron-ws/app-runtime";

// Flip to `true` individually to test each edge case.
const DEMO_THROW = false;
const DEMO_TIMEOUT = false;

export default async function (ctx: ServerContext) {
  // ── EDGE CASE: Unhandled throw ──────────────────────────────────────────
  // Even if a loader throws, Promise.allSettled catches it, logs:
  //   [egret] server loader for widget "errors/not-found" failed: Error: demo crash
  // …and the tree is sent without props from this loader only.
  if (DEMO_THROW) {
    throw new Error("demo crash — safe to ignore, testing error isolation");
  }

  // ── EDGE CASE: Hanging / slow loader ────────────────────────────────────
  // The runtime wraps every loader in Promise.race with a 3-second timeout.
  // A loader that never resolves is abandoned. The server log shows:
  //   [egret] server loader for widget "errors/not-found" failed:
  //     Error: server loader timed out after 3000ms: .../not-found/server.js
  // …and again, the page still loads with static props.
  if (DEMO_TIMEOUT) {
    await new Promise(() => {}); // hangs forever — will be killed by timeout
  }

  // ── NORMAL PATH ─────────────────────────────────────────────────────────
  // In a real app you might inject the attempted path or a user-friendly
  // error context. ctx.params contains route params; for the 404 fallback
  // there are none, but ctx.searchParams has the query string.
  const attemptedPath = ctx.searchParams["from"] ?? "unknown";

  return {
    attemptedPath,
    // EDGE CASE: returning undefined/null values in the object is fine —
    // they merge into props normally. Only the top-level return value must
    // be a plain object (not undefined, not an array).
    serverTimestamp: new Date().toISOString(),
  };
}
