import { signalingHttpUrl } from "@golive/core";
import { configuredBaseUrl } from "./sessionDeps";

export type AdminParticipant = {
  id: string;
  name: string;
  sharing: boolean;
  connectedAt: string;
};

export type AdminRoom = {
  id: string;
  startedAt: string;
  activeUsers: number;
  activeSharers: number;
  participants: AdminParticipant[];
};

export type AdminOverview = {
  generatedAt: string;
  serverStartedAt: string;
  scope: "process";
  summary: {
    activeRooms: number;
    activeUsers: number;
    activeSharers: number;
  };
  rooms: AdminRoom[];
  system: {
    process: {
      uptimeSeconds: number;
      cpuPercent: number;
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
    };
    host: {
      hostname: string;
      platform: string;
      cpuCount: number;
      cpuPercent: number;
      loadAverage: number[];
      totalMemoryBytes: number;
      freeMemoryBytes: number;
    };
    disk: {
      path: string;
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
    } | null;
  };
};

export type TurnUsage = {
  from: string;
  to: string;
  egressBytes: number;
  ingressBytes: number;
  egressGB: number;
  ingressGB: number;
  freeTierPercent: number;
};

export type TurnUsageResult = {
  usage: TurnUsage;
  fetchedAt: string | null;
  stale: boolean;
};

type WrappedTurnUsage = {
  usage: TurnUsage;
  fetchedAt: string;
  stale: boolean;
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
  searchParams?: URLSearchParams,
): Promise<T> {
  const url = new URL(signalingHttpUrl(configuredBaseUrl(), path));
  if (searchParams) url.search = searchParams.toString();

  const response = await fetch(url, {
    ...init,
    signal,
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      && typeof body.error === "string"
      ? body.error
      : `Admin request failed (${response.status})`;

    throw new AdminApiError(message, response.status);
  }

  return body as T;
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function adminLogin(secret: string): Promise<string> {
  const result = await requestJson<{ token: string; expiresInSeconds: number }>(
    "/admin/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    },
  );

  if (!result || typeof result.token !== "string") {
    throw new AdminApiError("The server returned an invalid login response.", 502);
  }

  return result.token;
}

export function getAdminOverview(token: string, signal: AbortSignal) {
  return requestJson<AdminOverview>(
    "/admin/overview",
    { method: "GET", headers: bearer(token) },
    signal,
  );
}

export async function getTurnUsage(
  token: string,
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<TurnUsageResult> {
  const url = new URL(signalingHttpUrl(configuredBaseUrl(), "/admin/turn-usage"));
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const result = await requestJson<TurnUsage | WrappedTurnUsage>(
    url.pathname,
    { method: "GET", headers: bearer(token) },
    signal,
    url.searchParams,
  );

  if ("usage" in result) {
    return result;
  }

  return { usage: result, fetchedAt: null, stale: false };
}
