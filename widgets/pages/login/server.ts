/**
 * Server-side loader for the public login widget.
 *
 * The personas endpoint does not require authentication, so the server can
 * preload it before rendering the login document. The full list is merged
 * into the widget's props for script.ts, while the named display props are
 * consumed by metadata.json during SSR.
 */
import type { ServerContext } from "@heron-ws/app-runtime";

interface Persona {
  id: string;
  name?: string;
  description?: string;
  roleName?: string;
}

const PERSONA_PROP_NAMES: Record<
  string,
  { name: string; description: string }
> = {
  admin: {
    name: "personaAdminName",
    description: "personaAdminDesc",
  },
  editor: {
    name: "personaEditorName",
    description: "personaEditorDesc",
  },
  viewer: {
    name: "personaViewerName",
    description: "personaViewerDesc",
  },
  viewer2: {
    name: "personaViewer2Name",
    description: "personaViewer2Desc",
  },
};

function personaProps(personas: Persona[]): Record<string, string> {
  const props: Record<string, string> = {};

  for (const persona of personas) {
    const propNames = PERSONA_PROP_NAMES[persona.id];
    if (!propNames) continue;
    props[propNames.name] = persona.name || persona.id;
    props[propNames.description] =
      persona.description || persona.roleName || "";
  }

  return props;
}

export default async function (ctx: ServerContext) {
  const { apiBase } = ctx.egret;

  if (!apiBase) {
    console.warn(
      "[login/server] apiBase not configured — using client persona fallback",
    );
    return {};
  }

  try {
    const res = await fetch(`${apiBase}/api/auth/personas`);
    if (!res.ok) {
      console.warn(
        `[login/server] /api/auth/personas → ${res.status}, using client fallback`,
      );
      return {};
    }

    const json = (await res.json()) as { data?: unknown };
    const personas = Array.isArray(json?.data)
      ? (json.data as Persona[])
      : [];
    console.log(personas);
    return {
      personas,
      ...personaProps(personas),
    };
  } catch (error) {
    console.warn(
      "[login/server] failed to preload personas — using client fallback",
      error,
    );
    return {};
  }
}
