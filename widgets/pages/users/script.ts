function usersScript($egret: any, $self: any) {
  function fakeApiBase(): string {
    const fromEnv = $egret?.getEnv?.("EGRET_FAKE_API_URL");
    if (typeof fromEnv === "string" && fromEnv) {
      return fromEnv.replace(/\/+$/, "");
    }
    return "http://localhost:4001";
  }

  const rowIds = [1, 2, 3] as const;

  function renderUsers(members: any[], source: string) {
    $self.getChild("@users-subtitle")?.setProps({
      text: `Loaded ${members.length} member(s) from Express fake API${source === "server" ? " (server pre-fetched)" : ""}.`,
    });
    for (let i = 0; i < rowIds.length; i++) {
      const n = rowIds[i];
      const m = members[i];
      if (!m) continue;
      $self.getChild(`@u${n}-initials`)?.setProps({ text: m.initials || "?" });
      $self.getChild(`@user-${n}-name`)?.setProps({ text: m.name || "" });
      $self.getChild(`@user-${n}-email`)?.setProps({ text: m.email || "" });
      $self.getChild(`@user-${n}-role`)?.setProps({ text: m.role || "" });
      $self.getChild(`@user-${n}-badge`)?.setProps({ text: m.status || "" });
    }
  }

  async function loadUsersFromApi() {
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    $self.getChild("@users-subtitle")?.setProps({
      text: "Loading team from fake API…",
    });

    try {
      const res = await fetch(`${fakeApiBase()}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        $self.getChild("@users-subtitle")?.setProps({
          text:
            res.status === 403
              ? "Forbidden — your role cannot read User."
              : `Failed to load users (${res.status}).`,
        });
        return;
      }
      const json = await res.json();
      const members = Array.isArray(json?.data) ? json.data : [];
      renderUsers(members, "client");
    } catch (err) {
      console.error("[users] fake API unreachable:", err);
      $self.getChild("@users-subtitle")?.setProps({
        text: "Fake API unreachable — is it running on :4001?",
      });
    }
  }

  async function loadUsers() {
    const props = $self.getProps?.() ?? {};
    const serverUsers: any[] | undefined = Array.isArray(props.users)
      ? props.users
      : undefined;

    if (serverUsers) {
      console.log(`[users] using ${serverUsers.length} user(s) from server loader`);
      renderUsers(serverUsers, "server");
    } else {
      await loadUsersFromApi();
    }
  }

  void loadUsers();

  // Admin-only (manage all → users.purge). Hidden for editor/viewer.
  $self.getChild("@purgeBtn")?.listen({
    onClick: () => {
      const allowed = $egret?.auth?.can?.("command", "users.purge");
      console.log("[users] Purge inactive clicked — can(command, users.purge) =", allowed);
      window.alert(
        allowed
          ? "Admin action: purge inactive (demo only)."
          : "You are not allowed to purge users.",
      );
    },
  });

  // Admin + editor.
  $self.getChild("@inviteBtn")?.listen({
    onClick: () => {
      const allowed = $egret?.auth?.can?.("command", "users.invite");
      console.log("[users] Invite clicked — can(command, users.invite) =", allowed);
      window.alert(
        allowed
          ? "Invite flow (demo only)."
          : "You are not allowed to invite users.",
      );
    },
  });
}

export default usersScript;
