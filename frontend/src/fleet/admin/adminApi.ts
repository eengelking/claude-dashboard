// The Admin API client (issue #36). Every call carries the header the server requires of a change, and the session
// cookie is HttpOnly, so nothing here can read it. Tokens and the admin secret live only in component state.

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}
export interface PersonRow {
  id: number;
  name: string;
  last4: string;
  groupId: number | null;
  groupName: string | null;
  createdAt: number;
  rotatedAt: number | null;
  revokedAt: number | null;
  lastReportAt: number | null;
  machines: string[];
}
export interface GroupRow {
  id: number;
  name: string;
  createdAt: number;
  members: string[];
}
export interface LogRow {
  id: number;
  t: number;
  kind: string;
  detail: string;
  source: string;
}
export interface GroupChoice {
  id: number;
  name: string;
}

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

export type AdminApi = <T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<T>;

export function makeApi(base = "/api/admin"): AdminApi {
  return async <T,>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: "same-origin",
      headers: { "X-Podium-Admin": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as { error?: string; retryAfterSec?: number } | null;
    if (!res.ok) throw new AdminError(res.status, data?.error ?? `HTTP ${res.status}`, data?.retryAfterSec);
    return data as T;
  };
}

export function query(params: Record<string, string | number | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `?${q}` : "";
}
