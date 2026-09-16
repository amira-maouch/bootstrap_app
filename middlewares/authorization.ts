// @Middleware({ target:"page", stage:"route_matched", priority:0 })
// Heron Option 2 — authorization bootstrap.
//
// `setEnabled` / `setTokenProvider` / the permissions loader are all wired
// once at app boot from app.config.ts (`authorization.enabled` / `tokenKey` /
// `authorization.auth.adapter`) — see AppShellClient in
// @heron-ws/app-runtime. This middleware's only job is: tell `$heron.auth`
// WHEN to (re)load permissions (on login / user change) or drop them (on
// logout).
//
// Keep this const as the first statement after @Middleware (transformer quirk).
const initializeAuthorization = async (
  context: any,
  next: any,
  _block: any,
) => {
  const heron = (globalThis as any).$heron;
  if (!heron?.auth) {
    await next();
    return;
  }

  if (!context.user) {
    heron.auth.clear();
    await next();
    return;
  }
  console.log("heron.auth", heron.auth);
  const key = String(context.user.id || context.user.role || "anon");
  await heron.auth.ensurePermissionsLoaded(key);

  await next();
};
