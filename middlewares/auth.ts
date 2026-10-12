// @Middleware({ target:"page", stage:"route_matched", priority:10 })
// Session guard against the Express fake API.
// Helpers below are function declarations so they hoist — keep this const
// as the first statement after the @Middleware comment (transformer quirk).
const authGuard = async (context: any, next: any, block: any) => {
  const PUBLIC_PAGES = new Set(["main", "login"]);
  // UI-only profile cache (id/name/role) for the header and sidebar. It holds
  // no credential and is never treated as proof of authentication.
  const USER_KEY = "auth_user";
  removeLegacyCredentials();

  if (PUBLIC_PAGES.has(context.pageName)) {
    // The landing page remains public for everyone, including signed-in users.
    // The login page retains the existing convenience redirect when a valid
    // session is already present.
    if (context.pageName === "login") {
      const user = await fetchSession();
      if (user) {
        writeProfile(USER_KEY, user);
        block("Already authenticated", "/dashboard");
        return;
      }
      clearProfile(USER_KEY);
    }
    await next();
    return;
  }

  const user = await fetchSession();
  if (!user) {
    clearProfile(USER_KEY);
    block("Not authenticated", loginRedirect());
    return;
  }

  writeProfile(USER_KEY, user);
  await next({ user });
};

// Memory-token mode: the access token lives only in $heron.auth memory and the
// session credential only in the HttpOnly cookie. Heron removes the configured
// `tokenKey` at boot; this also covers sessions created before the migration.
function removeLegacyCredentials() {
  try {
    localStorage.removeItem("auth_token");
  } catch {
    // ignore
  }
}

function clearProfile(USER_KEY: string) {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

function writeProfile(USER_KEY: string, user: unknown) {
  // The HttpOnly cookie, verified through /api/auth/session, is the browser
  // route-auth source of truth.
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

function loginRedirect(): string {
  const returnTo = `${location.pathname}${location.search}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

async function fetchSession(): Promise<any | null> {
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const principal = json?.data?.principal;
    if (!json?.success || !principal?.key) return null;
    const name = principal.name ?? principal.id ?? principal.key;
    return {
      id: principal.id ?? principal.key,
      name,
      role: principal.role ?? "viewer",
      roleId: principal.role ?? "viewer",
      initials: String(name)
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    };
  } catch {
    return null;
  }
}
