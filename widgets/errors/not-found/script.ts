function notFoundScript($egret: any, _$self: any) {
  const path = window.location.pathname;
  const auth = $egret?.auth;
  const snapshot = auth?.getSnapshot?.() ?? null;
  const rules = snapshot?.rules ?? [];

  // There's no page-view permission to check anymore — pages are gated by
  // business permissions (see app-manifest.json / permissions-adapter.ts),
  // so this logs those directly instead of a "page:x" grant that no longer
  // exists on the backend.
  const knownPages = [
    { action: "read", subject: "User" },
    { action: "write", subject: "User" },
    { action: "command", subject: "users.invite" },
    { action: "command", subject: "users.purge" },
    { action: "*", subject: "*" }, // admin-only ("has the full wildcard grant")
  ];

  const accessChecks = knownPages.map((c) => ({
    ...c,
    allowed: typeof auth?.can === "function" ? auth.can(c.action, c.subject) : null,
  }));

  console.group("[404 / not-found] diagnose");
  console.log(
    "Reason: widget fetch returned nothing → Heron fell back to the 404 widget.",
  );
  console.log(
    "Common causes: (1) unknown route, (2) /api/widgets returned 401/403 (auth missing or denied) — fetchWidget treats !res.ok as null, which looks like 404.",
  );
  console.log(
    "True access denials usually redirect to unauthorizedPath (/dashboard), not here.",
  );
  console.log("path:", path);
  console.log("auth.enabled:", auth?.enabled);
  console.log("auth.status:", auth?.status ?? snapshot?.status);
  console.log("auth.principalKey:", snapshot?.principalKey);
  console.log("permissions (rules):", rules);
  console.log("can() for known pages:", accessChecks);
  console.groupEnd();
}

export default notFoundScript;
