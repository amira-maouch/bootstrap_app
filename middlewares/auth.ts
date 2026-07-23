// @Middleware({ target:"page", stage:"route_matched", priority:10 })
// Session guard against the Express fake API.
// Helpers below are function declarations so they hoist — keep this const
// as the first statement after the @Middleware comment (transformer quirk).
const authGuard = async (context: any, next: any, block: any) => {
  const PUBLIC_PAGES = new Set(["login"]);
  const TOKEN_KEY = "auth_token";
  const USER_KEY = "auth_user";
  const token = readToken(TOKEN_KEY);

  if (PUBLIC_PAGES.has(context.pageName)) {
    if (token) {
      const user = await fetchMe(token);
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

  if (!token) {
    clearSession(TOKEN_KEY, USER_KEY);
    block("Not authenticated", "/login");
    return;
  }

  const user = await fetchMe(token);
  if (!user) {
    clearSession(TOKEN_KEY, USER_KEY);
    block("Not authenticated", "/login");
    return;
  }

  writeSession(TOKEN_KEY, USER_KEY, token, user);
  await next({ user });
};

function fakeApiBase(): string {
  try {
    const egret = (globalThis as any).$egret;
    const fromEnv = egret?.getEnv?.("EGRET_FAKE_API_URL");
    if (typeof fromEnv === "string" && fromEnv) {
      return fromEnv.replace(/\/+$/, "");
    }
  } catch {
    // ignore
  }
  return "http://localhost:4001";
}

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
  token: string,
  user: unknown,
) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

async function fetchMe(token: string): Promise<any | null> {
  try {
    const res = await fetch(`${fakeApiBase()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? json.data : null;
  } catch {
    return null;
  }
}
