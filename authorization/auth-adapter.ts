import type {
  AuthAdapter,
  AuthPrincipal,
  VerifiedIdentity,
} from "@heron-ws/app-runtime";
import { loadPermissions as loadBackendPermissions } from "./permissions-loader";
import { adaptPermissions } from "./permissions-adapter";

type BackendUser = {
  id: string;
  name?: string;
  role?: string;
  roleId?: string;
  expiresAt?: number;
};

function apiBase(): string {
  return (
    process.env.EGRET_FAKE_API_URL ||
    process.env.FAKE_API_URL ||
    "http://localhost:4001"
  ).replace(/\/+$/, "");
}

function principalFromUser(user: BackendUser): AuthPrincipal {
  return {
    key: user.id,
    id: user.id,
    ...(user.name ? { name: user.name } : {}),
    ...(user.role || user.roleId ? { role: user.role ?? user.roleId } : {}),
  };
}

const authAdapter: AuthAdapter = {
  async authenticate(credentials) {
    const response = await fetch(`${apiBase()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials ?? {}),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      success?: boolean;
      data?: {
        accessToken?: string;
        expiresAt?: number;
        user?: BackendUser;
      };
    };
    const credential = payload.data?.accessToken;
    const expiresAt = payload.data?.expiresAt;
    const user = payload.data?.user;
    if (
      payload.success !== true ||
      !credential ||
      !user?.id ||
      typeof expiresAt !== "number"
    ) {
      return null;
    }
    return {
      credential,
      // Compatibility for existing direct browser-to-backend script.ts calls.
      // New scripts should use: await $egret.auth.getAccessToken().
      browserToken: credential,
      principal: principalFromUser(user),
      expiresAt,
    };
  },

  async verify(credential) {
    const response = await fetch(`${apiBase()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${credential}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      success?: boolean;
      data?: BackendUser;
    };
    const user = payload.data;
    if (
      payload.success !== true ||
      !user?.id ||
      typeof user.expiresAt !== "number"
    ) {
      return null;
    }
    return {
      credential,
      principal: principalFromUser(user),
      expiresAt: user.expiresAt,
    };
  },

  async revoke(credential) {
    try {
      await fetch(`${apiBase()}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credential}` },
      });
    } catch {
      // The Heron cookie is still cleared if the backend is unavailable.
    }
  },

  async loadPermissions(identity: VerifiedIdentity) {
    const raw = await loadBackendPermissions(identity.credential);
    return adaptPermissions(raw);
  },
};

export const authenticate = authAdapter.authenticate;
export const verify = authAdapter.verify;
export const revoke = authAdapter.revoke;
export const loadPermissions = authAdapter.loadPermissions;
export default authAdapter;
