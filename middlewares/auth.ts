// @Middleware({ target:"page", stage:"route_matched", priority:10 })
// Session guard against the Express fake API.
// Helpers below are function declarations so they hoist — keep this const
// as the first statement after the @Middleware comment (transformer quirk).
const authGuard = async (context: any, next: any, block: any) => {
  const PUBLIC_PAGES = new Set(["main", "login"]);
  const TOKEN_KEY = "auth_token";
  const USER_KEY = "auth_user";
  const token = readToken(TOKEN_KEY);

  if (PUBLIC_PAGES.has(context.pageName)) {
    // The landing page remains public for everyone, including signed-in users.
    // The login page retains the existing convenience redirect when a valid
    // session is already present.
    if (context.pageName === "login") {
      const user = await fetchSession();
      if (user) {
        writeSession(TOKEN_KEY, USER_KEY, token, user);
        block("Already authenticated", "/dashboard");
        return;
      }
      clearSession(TOKEN_KEY, USER_KEY);
    }
    await next();
    return;
  }

  const user = await fetchSession();
  if (!user) {
    clearSession(TOKEN_KEY, USER_KEY);
    block("Not authenticated", loginRedirect());
    return;
  }

  writeSession(TOKEN_KEY, USER_KEY, token, user);
  await next({ user });
};

function readToken(TOKEN_KEY: string): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearSession(TOKEN_KEY: string, USER_KEY: string) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

function writeSession(
  TOKEN_KEY: string,
  USER_KEY: string,
  token: string | null,
  user: unknown,
) {
  // The HttpOnly cookie, verified through /api/auth/session, is the browser
  // route-auth source of truth. Keep an existing compatibility token for
  // script.ts calls, but do not require or manufacture one here.
  if (token) localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
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
