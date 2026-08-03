function appHeaderScript($egret: any, $self: any) {
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
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data?.browserToken) {
        console.error("[header] switch role failed", json);
        return;
      }
      const principal = json.data.principal ?? {};
      const name = principal.name ?? userId;
      localStorage.setItem("auth_token", json.data.browserToken);
      localStorage.setItem(
        "auth_user",
        JSON.stringify({
          id: principal.id ?? principal.key ?? userId,
          name,
          role: principal.role ?? "viewer",
          roleId: principal.role ?? "viewer",
          initials: String(name)
            .split(/\s+/)
            .filter(Boolean)
            .map((part: string) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
        }),
      );
      window.location.reload();
    } catch (err) {
      console.error("[header] fake API unreachable:", err);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {
      // Local runtime state is still cleared below.
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
