/**
 * "Team Tasks" demonstrates two things at once:
 *
 *  1. Server-side widget loaders: `server.ts` pre-fetches `/api/tasks` on the
 *     server during page resolution and merges the result into `$self.getProps()`.
 *     This script reads `tasks` from props first, skipping a client-side fetch
 *     when the data is already present (eliminates the initial data waterfall).
 *     A graceful fallback fetch still runs when props are absent (raw section
 *     fetches, loader errors, auth not yet resolved).
 *
 *  2. Row-level conditions (authorization): `read:Task:own` grants are turned
 *     into `{ conditions: { assigneeId } }` rules by `permissions-adapter.ts`.
 *     This script reads the RAW rule via `$egret.auth.getPermission()` for the
 *     UI projection. The fake API independently enforces the same boundary
 *     before data reaches this script.
 *
 * Role recap:
 *   - admin  -> "*"              -> sees every task (no conditions)
 *   - editor -> "read:Task"      -> sees every task (no conditions)
 *   - viewer / viewer2 -> "read:Task:own" -> each sees ONLY their own row
 *     (same static grant, different `conditions.assigneeId` per caller)
 */
function dashboardScript($egret: any, $self: any) {
  function fakeApiBase(): string {
    const fromEnv = $egret?.getEnv?.("EGRET_FAKE_API_URL");
    if (typeof fromEnv === "string" && fromEnv) {
      return fromEnv.replace(/\/+$/, "");
    }
    return "http://localhost:4001";
  }

  const TASK_ROW_COUNT = 5;

  // Must mirror each row's className in metadata.json (minus "d-flex"/"d-none",
  // which this toggles). NOTE: inline `style: { display: "none" }` does NOT
  // work here — these rows use Bootstrap's `d-flex` utility class, which sets
  // `display: flex !important`, and a plain inline style can never win
  // against a class rule with `!important`. Swapping the class itself
  // (`d-flex` <-> `d-none`) avoids that fight entirely.
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

  /**
   * `rule.conditions` can be ANYTHING an adapter produced — this app's
   * adapter happens to emit a plain object, but nothing in Heron requires
   * that. Branch on the actual shape rather than assuming one:
   *   - no rule at all        -> no access, show nothing
   *   - conditions == null    -> unconditioned grant, show everything
   *   - a plain object        -> exactly what can(action, subject, resource)
   *                              already evaluates via CASL — shown here
   *                              explicitly since we already have the rule
   *   - an array               -> e.g. a raw list of allowed ids
   *   - anything else          -> extend here for your own backend's shape
   */
  function filterTasksByRule(tasks: any[], rule: any, auth: any): any[] {
    if (!rule) return [];
    const conditions = rule.conditions;
    if (conditions == null) return tasks;
    if (Array.isArray(conditions)) {
      return tasks.filter((t) => conditions.includes(t.assigneeId));
    }
    if (typeof conditions === "object") {
      return tasks.filter((t) => auth?.can?.("read", "Task", t));
    }
    console.warn(
      "[dashboard] unrecognized conditions shape, denying:",
      conditions,
    );
    return [];
  }

  function describeVisibility(
    rule: any,
    visible: number,
    total: number,
    source: string,
  ): string {
    const sourceTag =
      source === "server" ? " (server pre-fetched)" : " (client fetched)";
    if (!rule) return `You do not have permission to view tasks.${sourceTag}`;
    if (rule.conditions == null) {
      return `Showing all ${total} task(s) — unrestricted "read:Task" grant.${sourceTag}`;
    }
    return `Showing ${visible} of ${total} task(s) — restricted by conditions: ${JSON.stringify(rule.conditions)}.${sourceTag}`;
  }

  function renderTasks(allTasks: any[], source: string) {
    const auth = $egret?.auth;

    // The escape hatch this whole demo is about: fetch the RAW rule
    // (with its raw conditions) instead of only asking can()/cannot().
    const rule = auth?.getPermission?.("read", "Task");
    console.log("[dashboard] getPermission('read', 'Task') ->", rule);

    const visibleTasks = filterTasksByRule(allTasks, rule, auth);

    for (let i = 0; i < TASK_ROW_COUNT; i++) {
      const n = i + 1;
      const task = visibleTasks[i];
      $self.getChild(`@taskRow${n}`)?.setProps({
        className: rowClassName(n, Boolean(task)),
      });
      if (!task) continue;
      $self.getChild(`@task${n}-title`)?.setProps({ text: task.title });
      $self.getChild(`@task${n}-assignee`)?.setProps({
        text: task.assigneeName || task.assigneeId,
      });
      $self.getChild(`@task${n}-status`)?.setProps({ text: task.status });
    }

    $self.getChild("@tasksSubtitle")?.setProps({
      text: describeVisibility(
        rule,
        visibleTasks.length,
        allTasks.length,
        source,
      ),
    });
  }

  async function loadTasksFromApi() {
    const token = await $egret?.auth?.getAccessToken?.();

    try {
      const res = await fetch(`${fakeApiBase()}/api/tasks`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        $self.getChild("@tasksSubtitle")?.setProps({
          text: `Failed to load tasks (${res.status}).`,
        });
        return;
      }
      const json = await res.json();
      const allTasks: any[] = Array.isArray(json?.data) ? json.data : [];
      renderTasks(allTasks, "client");
    } catch (err) {
      console.error("[dashboard] fake API unreachable:", err);
      $self.getChild("@tasksSubtitle")?.setProps({
        text: "Fake API unreachable — is it running on :4001?",
      });
    }
  }

  async function loadTasks() {
    // Prefer tasks pre-fetched by the server loader (server.ts).
    // `$self.getProps()` is populated from the widget's `props` in the metadata
    // tree, which the server loader merges into before serialisation. When the
    // loader ran successfully, `tasks` is already here — no client fetch needed.
    const props = $self.getProps?.() ?? {};
    const loaderProvenance = props.__egretLoader;
    const hasPreloadedTasks =
      loaderProvenance?.source === "server-loader" &&
      Array.isArray(loaderProvenance.keys) &&
      loaderProvenance.keys.includes("tasks") &&
      Array.isArray(props.tasks);

    if (hasPreloadedTasks) {
      console.log(
        `[dashboard] using ${props.tasks.length} task(s) from server loader`,
      );
      renderTasks(props.tasks, "server");
    } else {
      // Graceful client-side fallback: loader wasn't available, timed out, or
      // this is a raw/section fetch where server loaders don't run.
      await loadTasksFromApi();
    }
  }

  void loadTasks();

  // Re-render when auth state changes (e.g. permissions loaded after mount):
  // the task LIST itself doesn't change, but which rows are VISIBLE may change
  // once `getPermission('read', 'Task')` returns the real rule.
  if (typeof $egret?.auth?.subscribe === "function") {
    $egret.auth.subscribe(() => void loadTasks());
  }
}

export default dashboardScript;
