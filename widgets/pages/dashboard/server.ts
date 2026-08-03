/**
 * Server-side loader for the Dashboard widget.
 *
 * This file is compiled to `dist-app/server/pages/dashboard/server.js` by
 * `egret-build-widgets` and executed on the server during page resolution.
 * Its return value is merged into the dashboard widget's `props` before the
 * metadata tree is sent to the browser.
 *
 * `metadata.json` binds each task row's text/className to `{{props.taskN*}}`
 * tokens (resolved synchronously before `renderToString()`), so the rows
 * below are real content in the SSR HTML with JavaScript disabled — not just
 * data available for a post-hydration script to paint in.
 *
 * The widget script (`script.ts`) still reads `$self.getProps().tasks` on
 * mount and re-applies the same values (plus the richer, permission-aware
 * subtitle wording once `$egret.auth` resolves) — a graceful client-side
 * fallback still runs when the loader wasn't available (e.g. when fetching a
 * raw section reference).
 *
 * The backend applies row-level authorization before returning tasks (see
 * fake-api's `/api/tasks`). The browser's matching condition filter remains a
 * UX projection only.
 */

import type { ServerContext } from "@heron-ws/app-runtime";

const TASK_ROW_COUNT = 5;

// Must mirror `ROW_BASE_CLASS` in script.ts — see that file for why the
// visibility toggle is a full className swap rather than an inline style.
const ROW_BASE_CLASS: Record<number, string> = {
  1: "align-items-center border-bottom py-2 px-3 small",
  2: "align-items-center border-bottom py-2 px-3 small",
  3: "align-items-center border-bottom py-2 px-3 small",
  4: "align-items-center border-bottom py-2 px-3 small",
  5: "align-items-center py-2 px-3 small",
};

function rowClassName(n: number, visible: boolean): string {
  return `${visible ? "d-flex" : "d-none"} ${ROW_BASE_CLASS[n]}`;
}

interface Task {
  title?: string;
  assigneeName?: string;
  assigneeId?: string;
  status?: string;
}

function taskRowProps(tasks: Task[]): Record<string, string> {
  const props: Record<string, string> = {};
  for (let i = 0; i < TASK_ROW_COUNT; i++) {
    const n = i + 1;
    const task = tasks[i];
    props[`task${n}Title`] = task?.title ?? "";
    props[`task${n}Assignee`] = task?.assigneeName || task?.assigneeId || "";
    props[`task${n}Status`] = task?.status ?? "";
    props[`task${n}RowClass`] = rowClassName(n, Boolean(task));
  }
  return props;
}

function tasksSubtitleText(tasks: Task[]): string {
  if (tasks.length === 0) {
    return "You do not have permission to view tasks. (server pre-fetched)";
  }
  return `Showing ${tasks.length} task(s). (server pre-fetched)`;
}

export default async function loader(ctx: ServerContext) {
  const { token } = ctx.session;
  const apiBase = ctx.egret.apiBase;

  if (!apiBase) {
    console.warn(
      "[dashboard/server] ctx.egret.apiBase is empty — set `apiBase` in app.config.ts or EGRET_API_BASE_URL env var",
    );
    return {};
  }

  if (!token) {
    // No auth token — the middleware hasn't authenticated this request yet.
    // Return nothing; the client script will fetch tasks after auth completes.
    return {};
  }

  const res = await fetch(`${apiBase}/api/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.warn(
      `[dashboard/server] /api/tasks responded ${res.status} — skipping server pre-fetch`,
    );
    return {};
  }

  const json = (await res.json()) as { data?: unknown };
  const tasks: Task[] = Array.isArray(json?.data) ? json.data : [];
  return {
    tasks,
    ...taskRowProps(tasks),
    tasksSubtitleText: tasksSubtitleText(tasks),
  };
}
