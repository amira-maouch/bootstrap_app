// @Middleware({ target:"page", stage:"route_matched", priority:0 })
// Heron Option 2 — authorization bootstrap.
//
// `setEnabled` / `setTokenProvider` / the permissions loader are all wired
// once at app boot from app.config.ts (`authorization.enabled` / `tokenKey` /
// `authorization.auth.adapter`) — see AppShellClient in
// @heron-ws/app-runtime. This middleware's only job is: tell `$egret.auth`
// WHEN to (re)load permissions (on login / user change) or drop them (on
// logout).
//
// Keep this const as the first statement after @Middleware (transformer quirk).
const initializeAuthorization = async (
  context: any,
  next: any,
  _block: any,
) => {
  const egret = (globalThis as any).$egret;
  if (!egret?.auth) {
    await next();
    return;
  }

  if (!context.user) {
    egret.auth.clear();
    await next();
    return;
  }
  console.log("egret.auth", egret.auth);
  const key = String(context.user.id || context.user.role || "anon");
  await egret.auth.ensurePermissionsLoaded(key);

  await next();
};
