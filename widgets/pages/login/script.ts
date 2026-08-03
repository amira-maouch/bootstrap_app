function loginScript($egret: any, $self: any) {
  interface Persona {
    id: string;
    name?: string;
    description?: string;
    roleName?: string;
  }

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
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data?.browserToken) {
        console.error("[login] failed", json);
        return;
      }
      const accessToken = json.data.browserToken;
      const principal = json.data.principal ?? {};
      const user = {
        id: principal.id ?? principal.key ?? userId,
        name: principal.name ?? userId,
        role: principal.role ?? "viewer",
        roleId: principal.role ?? "viewer",
        initials: String(principal.name ?? userId)
          .split(/\s+/)
          .filter(Boolean)
          .map((part: string) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
      };
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
        // AuthAdapter.loadPermissions(identity). The demo adapter composes
        // permissions-loader.ts (fetch raw grants) and
        // permissions-adapter.ts (translate to Heron rules). This is what
        // $egret.auth loads through Heron's GET /api/auth/permissions.
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

      const candidate = new URL(window.location.href).searchParams.get(
        "returnTo",
      );
      const destination =
        candidate &&
        candidate.startsWith("/") &&
        !candidate.startsWith("//") &&
        new URL(candidate, window.location.origin).origin ===
          window.location.origin
          ? candidate
          : "/dashboard";
      window.location.href = destination;
    } catch (err) {
      console.error("[login] fake API unreachable:", err);
    }
  }

  function applyPersonas(personas: Persona[]) {
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
  }

  async function loadPersonas() {
    const preloadedPersonas = $self.getProps()?.personas;
    if (Array.isArray(preloadedPersonas) && preloadedPersonas.length > 0) {
      applyPersonas(preloadedPersonas);
      return;
    }

    try {
      const res = await fetch(`${fakeApiBase()}/api/auth/personas`);
      const json = await res.json();
      const personas = Array.isArray(json?.data)
        ? (json.data as Persona[])
        : [];
      applyPersonas(personas);
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
