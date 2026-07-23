function loginScript($egret: any, $self: any) {
  function fakeApiBase(): string {
    const fromEnv = $egret?.getEnv?.("EGRET_FAKE_API_URL");
    if (typeof fromEnv === "string" && fromEnv) {
      return fromEnv.replace(/\/+$/, "");
    }
    return "http://localhost:4001";
  }

  const PERSONA_UI: Record<
    string,
    { button: string; name: string; desc: string }
  > = {
    admin: {
      button: "@personaAdmin",
      name: "@personaAdminName",
      desc: "@personaAdminDesc",
    },
    editor: {
      button: "@personaEditor",
      name: "@personaEditorName",
      desc: "@personaEditorDesc",
    },
    viewer: {
      button: "@personaViewer",
      name: "@personaViewerName",
      desc: "@personaViewerDesc",
    },
    viewer2: {
      button: "@personaViewer2",
      name: "@personaViewer2Name",
      desc: "@personaViewer2Desc",
    },
  };

  async function signIn(userId: string) {
    try {
      const res = await fetch(`${fakeApiBase()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data?.accessToken) {
        console.error("[login] failed", json);
        return;
      }
      const { accessToken, user } = json.data;
      localStorage.setItem("auth_token", accessToken);
      localStorage.setItem("auth_user", JSON.stringify(user));

      console.log("[login] signed in as", user);
      try {
        // The fake API's OWN native format — grant strings, not Heron syntax.
        const grantsRes = await fetch(
          `${fakeApiBase()}/api/authorization/permissions`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const grantsJson = await grantsRes.json();
        console.log(
          "[login] backend-native grants for",
          user?.id ?? userId,
          grantsJson?.data?.grants ?? grantsJson,
        );

        // Same permissions, resolved by Heron server-side via
        // authorization/permissions-loader.ts (fetch the raw grants above)
        // + permissions-adapter.ts (pure translate → Heron rules) — this is
        // what $egret.auth actually loads (via Heron's own
        // GET /api/auth/permissions).
        const rulesRes = await fetch("/api/auth/permissions", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const rulesJson = await rulesRes.json();
        console.log(
          "[login] heron rules for",
          user?.id ?? userId,
          rulesJson?.data?.rules ?? rulesJson,
        );
      } catch (permErr) {
        console.warn("[login] could not load permissions:", permErr);
      }

      window.location.href = "/dashboard";
    } catch (err) {
      console.error("[login] fake API unreachable:", err);
    }
  }

  async function loadPersonas() {
    try {
      const res = await fetch(`${fakeApiBase()}/api/auth/personas`);
      const json = await res.json();
      const personas = Array.isArray(json?.data) ? json.data : [];

      for (const persona of personas) {
        const ui = PERSONA_UI[persona.id];
        if (!ui) continue;
        $self.getChild(ui.name)?.setProps({
          text: persona.name || persona.id,
        });
        $self.getChild(ui.desc)?.setProps({
          text: persona.description || persona.roleName || "",
        });
        $self.getChild(ui.button)?.listen({
          onClick: () => void signIn(persona.id),
        });
      }
    } catch (err) {
      console.error("[login] failed to load personas:", err);
      $self.getChild("@personaAdminName")?.setProps({
        text: "Fake API unreachable",
      });
      $self.getChild("@personaEditorName")?.setProps({ text: "…" });
      $self.getChild("@personaViewerName")?.setProps({ text: "…" });
      $self.getChild("@personaViewer2Name")?.setProps({ text: "…" });
    }
  }

  void loadPersonas();
}

export default loginScript;
