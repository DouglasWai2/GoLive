import { env } from "../config/env.js";
import type {
  CloudflareGraphQlResponse,
  CloudflareTurnUsage,
  IceServer,
  TurnCredentialsResponse,
  TurnUsageResult,
} from "../types/turn.js";

const TURN_USAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const TURN_CREDENTIAL_TTL_SECONDS = 8 * 60 * 60;
const PROVIDER_TIMEOUT_MS = 8_000;

export class TurnServiceError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = "TURN_ERROR",
  ) {
    super(message);
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function parseIceServers(value: unknown): IceServer[] {
  if (!value || typeof value !== "object") return [];

  const entries = (value as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(entries)) return [];

  return entries.filter((entry): entry is IceServer => {
    if (!entry || typeof entry !== "object") return false;

    const server = entry as Record<string, unknown>;
    const urls = typeof server.urls === "string"
      ? [server.urls]
      : Array.isArray(server.urls)
        ? server.urls.filter((url): url is string => typeof url === "string")
        : [];

    if (urls.length === 0) return false;

    const isTurn = urls.some((url) => /^turns?:/i.test(url));
    return !isTurn
      || (typeof server.username === "string"
        && typeof server.credential === "string");
  });
}

function containsTurnServer(servers: IceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => /^turns?:/i.test(url));
  });
}

export class TurnService {
  private readonly cachedTurnUsage = new Map<string, {
    expiresAt: number;
    fetchedAt: string;
    usage: CloudflareTurnUsage;
  }>();
  private readonly inFlightRequests = new Map<string, Promise<TurnUsageResult>>();

  async generateIceServers(now = new Date()): Promise<TurnCredentialsResponse> {
    if (env.turnKeyId && env.turnApiToken) {
      try {
        const { usage } = await this.getCachedUsage(monthStart(now), now);

        if (usage.egressGB < env.cloudflareTurnSwitchGB) {
          try {
            return await this.generateCloudflareIceServers();
          } catch (error) {
            console.warn("Cloudflare TURN credentials failed; using ExpressTURN", error);
          }
        }
      } catch (error) {
        console.warn("Cloudflare TURN usage unavailable; using ExpressTURN", error);
      }
    }

    return this.getExpressTurnIceServers();
  }

  async getCachedUsage(
    from: Date,
    to: Date = new Date(),
  ): Promise<TurnUsageResult> {
    const now = Date.now();
    const dateFrom = toDateString(from);
    const dateTo = toDateString(to);
    const cacheKey = `${dateFrom}:${dateTo}`;
    const cached = this.cachedTurnUsage.get(cacheKey);

    if (cached && now < cached.expiresAt) {
      return { usage: cached.usage, fetchedAt: cached.fetchedAt, stale: false };
    }

    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async (): Promise<TurnUsageResult> => {
      try {
        const usage = await this.getUsage(dateFrom, dateTo);
        const fetchedAt = new Date().toISOString();
        this.cachedTurnUsage.set(cacheKey, {
          expiresAt: Date.now() + TURN_USAGE_CACHE_TTL_MS,
          fetchedAt,
          usage,
        });
        return { usage, fetchedAt, stale: false };
      } catch (error) {
        if (cached) {
          return { usage: cached.usage, fetchedAt: cached.fetchedAt, stale: true };
        }
        throw error;
      } finally {
        this.inFlightRequests.delete(cacheKey);
      }
    })();

    this.inFlightRequests.set(cacheKey, promise);
    return promise;
  }

  private async generateCloudflareIceServers(): Promise<TurnCredentialsResponse> {
    const turnKeyId = env.turnKeyId;
    const turnApiToken = env.turnApiToken;

    if (!turnKeyId || !turnApiToken) {
      throw new Error("Cloudflare TURN configuration missing");
    }

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new Error(`Cloudflare credentials request failed: ${response.status}`);
    }

    const iceServers = parseIceServers(await response.json());
    if (!containsTurnServer(iceServers)) {
      throw new Error("Cloudflare returned no TURN server");
    }

    return { iceServers };
  }

  private getExpressTurnIceServers(): TurnCredentialsResponse {
    const urls = env.expressTurnUrls;
    const username = env.expressTurnUsername;
    const credential = env.expressTurnCredential;

    if (env.expressTurnDisabled || urls.length === 0 || !username || !credential) {
      throw new TurnServiceError(
        "TURN relay is temporarily unavailable",
        503,
        "TURN_UNAVAILABLE",
      );
    }

    return {
      iceServers: [{ urls, username, credential }],
    };
  }

  private async getUsage(
    dateFrom: string,
    dateTo: string,
  ): Promise<CloudflareTurnUsage> {
    const accountId = env.cloudflareAccountId;
    const apiToken = env.cloudflareAnalyticsApiToken;

    if (!accountId || !apiToken) {
      throw new Error("Cloudflare analytics configuration missing");
    }

    const query = `
      query TurnUsage {
        viewer {
          accounts(filter: { accountTag: "${accountId}" }) {
            callsTurnUsageAdaptiveGroups(
              limit: 1
              filter: { date_geq: "${dateFrom}", date_leq: "${dateTo}" }
            ) {
              sum { egressBytes ingressBytes }
            }
          }
        }
      }
    `;

    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Cloudflare analytics request failed: ${response.status}`);
    }

    const result = (await response.json()) as CloudflareGraphQlResponse;
    if (result.errors?.length) {
      throw new Error("Cloudflare analytics returned an error");
    }

    const account = result.data?.viewer?.accounts?.[0];
    if (!account) {
      throw new Error("Cloudflare analytics returned no account data");
    }

    const sum = account.callsTurnUsageAdaptiveGroups?.[0]?.sum;
    const egressBytes = sum?.egressBytes ?? 0;
    const ingressBytes = sum?.ingressBytes ?? 0;
    const egressGB = egressBytes / 1_000_000_000;
    const ingressGB = ingressBytes / 1_000_000_000;

    return {
      from: dateFrom,
      to: dateTo,
      egressBytes,
      ingressBytes,
      egressGB,
      ingressGB,
      freeTierPercent: (egressGB / 1000) * 100,
    };
  }
}
