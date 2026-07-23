/**
 * "Team Tasks" demonstrates rules with row-level `conditions`:
 *   - admin  -> unconditioned "*"           -> sees every task
 *   - editor -> unconditioned "read:Task"   -> sees every task
 *   - viewer / viewer2 -> "read:Task:own"   -> each sees ONLY their own row
 *     (same role, same static grant — the adapter turns it into a
 *     different `conditions` per caller; see permissions-adapter.ts).
 *
 * The interesting part: `read`/`Task` is fetched via
 * `$egret.auth.getPermission()`, not `can()`. That hands back the RAW rule
 * (including whatever shape `conditions` is) so this script decides how to
 * apply it — rather than only relying on `can()`'s built-in matching, which
 * only understands plain-object conditions. See `filterTasksByRule` below.
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
    console.warn("[dashboard] unrecognized conditions shape, denying:", conditions);
    return [];
  }

  function describeVisibility(rule: any, visible: number, total: number): string {
    if (!rule) return "You do not have permission to view tasks.";
    if (rule.conditions == null) {
      return `Showing all ${total} task(s) — unrestricted "read:Task" grant.`;
    }
    return `Showing ${visible} of ${total} task(s) — restricted by conditions: ${JSON.stringify(rule.conditions)}.`;
  }

  async function loadTasks() {
    const token = localStorage.getItem("auth_token");
    const auth = $egret?.auth;

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
        text: describeVisibility(rule, visibleTasks.length, allTasks.length),
      });
    } catch (err) {
      console.error("[dashboard] fake API unreachable:", err);
      $self.getChild("@tasksSubtitle")?.setProps({
        text: "Fake API unreachable — is it running on :4001?",
      });
    }
  }

  void loadTasks();

  if (typeof $egret?.auth?.subscribe === "function") {
    $egret.auth.subscribe(() => void loadTasks());
  }
}

export default dashboardScript;
