function sidebarMenuScript($egret: any, $self: any) {
  // Users page has no dedicated "view" permission — it's a business decision
  // ("can see this if you can do ANYTHING to a User"), not something the
  // backend hands us as a page grant. Mirrors the route `can` in
  // app-manifest.json and the node `can` on @navUsers.
  const USERS_PAGE_ACCESS = [
    { action: "read", subject: "User" },
    { action: "write", subject: "User" },
    { action: "command", subject: "users.invite" },
    { action: "command", subject: "users.purge" },
  ];

  function applyNavVisibility() {
    const auth = $egret?.auth;
    const showUsers = !auth?.enabled || auth.canAny(USERS_PAGE_ACCESS);
    // Settings is admin-only: "*"/"*" as a CHECK means "has the full
    // wildcard grant", not "has any rule" — see compileRules in
    // @heron-ws/component-api.
    const showSettings = !auth?.enabled || auth.can("*", "*");

    $self.getChild("@navUsers")?.setProps({
      style: {
        color: "var(--sidebar-foreground)",
        opacity: "0.75",
        display: showUsers ? undefined : "none",
      },
    });
    $self.getChild("@navSettings")?.setProps({
      style: {
        color: "var(--sidebar-foreground)",
        opacity: "0.75",
        display: showSettings ? undefined : "none",
      },
    });
  }

  function applyUserFooter() {
    try {
      const raw = localStorage.getItem("auth_user");
      if (!raw) return;
      const user = JSON.parse(raw);
      $self.getChild("@userInitials")?.setProps({ text: user.initials || "?" });
      $self.getChild("@userName")?.setProps({ text: user.name || "User" });
      $self.getChild("@userEmail")?.setProps({
        text: `${user.email || ""} · ${user.role || ""}`,
      });
    } catch {
      // ignore
    }
  }

  applyNavVisibility();
  applyUserFooter();

  if (typeof $egret?.auth?.subscribe === "function") {
    $egret.auth.subscribe(() => {
      applyNavVisibility();
      applyUserFooter();
    });
  }
}

export default sidebarMenuScript;
