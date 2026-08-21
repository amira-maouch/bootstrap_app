/**
 * Server-side loader + actions for the Settings widget.
 *
 * `loader` pre-fills first paint. `actions.updateProfile` mutates on the
 * server after hydration via `$self.actions.updateProfile(...)`.
 */
import {
  defineActions,
  type ActionContext,
} from "@heron-ws/app-runtime/server-actions";
import type { ServerContext } from "@heron-ws/app-runtime";

async function loadProfile(ctx: ServerContext) {
  const { token } = ctx.session;
  const { apiBase } = ctx.egret;
  if (!token || !apiBase) return {};

  const res = await fetch(`${apiBase}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const json = (await res.json()) as {
    data?: { name?: string; email?: string; role?: string };
  };
  return json?.data ?? {};
}

export default async function (ctx: ServerContext) {
  const { token } = ctx.session;
  const { apiBase } = ctx.egret;

  if (!token) {
    console.warn("[settings/server] no token — returning empty props");
    return {};
  }

  if (!apiBase) {
    console.warn("[settings/server] apiBase not configured — skipping pre-fetch");
    return {};
  }

  const profile = (await loadProfile(ctx)) as {
    name?: string;
    email?: string;
    role?: string;
  };

  const seoSource = {
    name: `${profile.name ?? "Unknown"}'s Settings`,
    description: `Account settings for ${profile.email ?? "your account"}`,
  };

  const seo = {
    title: `Settings — ${profile.name ?? "Unknown"}`,
    robots: "noindex",
  };

  return {
    profileName: profile.name ?? "Unknown",
    profileEmail: profile.email ?? "",
    profileRole: profile.role ?? "",
    seoSource,
    seo,
  };
}

export const actions = defineActions({
  updateProfile: {
    args: {
      name: { type: "string", required: true, minLength: 1, maxLength: 80 },
    },
    can: { action: "*", subject: "*" },
    rateLimit: { windowMs: 60_000, max: 10 },
    async fn(ctx: ActionContext<{ name: string }>) {
      console.log("updateProfile", ctx.args);
      const user = ctx.getUser();
      if (!user) {
        throw new Error("not authenticated");
      }
      const res = await ctx.fetchApi("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ctx.args.name }),
      });
      if (!res.ok) {
        throw new Error("profile update failed");
      }
      const json = (await res.json()) as {
        data?: { name?: string; email?: string; role?: string };
      };
      const profile = json.data ?? {};
      return {
        profileName: profile.name ?? ctx.args.name,
        profileEmail: profile.email ?? "",
        profileRole: profile.role ?? "",
      };
    },
  },
});
