function appHeaderScript($egret: any, $self: any) {
  function fakeApiBase(): string {
    const fromEnv = $egret?.getEnv?.("EGRET_FAKE_API_URL");
    if (typeof fromEnv === "string" && fromEnv) {
      return fromEnv.replace(/\/+$/, "");
    }
    return "http://localhost:4001";
  }

  function currentRole(): string {
    try {
      const raw = localStorage.getItem("auth_user");
      if (!raw) return "viewer";
      return JSON.parse(raw).role || "viewer";
    } catch {
      return "viewer";
    }
  }

  function refreshBadge() {
    try {
      const raw = localStorage.getItem("auth_user");
      if (!raw) return;
      const user = JSON.parse(raw);
      $self.getChild("@avatarInitials")?.setProps({
        text: user.initials || "?",
      });
      $self.getChild("@username")?.setProps({
        text: `${user.name} (${user.role})`,
      });
      $self.getChild("@roleLabel")?.setProps({
        text: `Role: ${user.role}`,
      });
    } catch {
      // ignore
    }
  }

  async function switchRole(userId: string) {
    try {
      const res = await fetch(`${fakeApiBase()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data?.accessToken) {
        console.error("[header] switch role failed", json);
        return;
      }
      localStorage.setItem("auth_token", json.data.accessToken);
      localStorage.setItem("auth_user", JSON.stringify(json.data.user));
      window.location.reload();
    } catch (err) {
      console.error("[header] fake API unreachable:", err);
    }
  }

  async function signOut() {
    const token = localStorage.getItem("auth_token");
    if (token) {
      try {
        await fetch(`${fakeApiBase()}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore network errors on logout
      }
    }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/login";
  }

  refreshBadge();

  $self.getChild("@switchRoleBtn")?.listen({
    onClick: () => {
      const order = ["admin", "editor", "viewer"];
      const idx = order.indexOf(currentRole());
      const next = order[(idx + 1) % order.length];
      void switchRole(next);
    },
  });

  $self.getChild("@signOutBtn")?.listen({
    onClick: () => void signOut(),
  });

  if (typeof $egret?.auth?.subscribe === "function") {
    $egret.auth.subscribe(() => refreshBadge());
  }
}

export default appHeaderScript;
