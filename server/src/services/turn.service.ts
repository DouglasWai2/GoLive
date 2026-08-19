import type { CloudflareGraphQlResponse, CloudflareTurnUsage } from "../types/turn.js";
import { env } from "../config/env.js";

const TURN_USAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export class TurnServiceError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class TurnService {
  private cachedTurnUsage: CloudflareTurnUsage | null = null;
  private cacheExpiresAt = 0;
  private inFlightRequest: Promise<CloudflareTurnUsage> | null = null;

  async generateIceServers(): Promise<unknown> {
    const turnKeyId = env.turnKeyId;
    const turnApiToken = env.turnApiToken;

    if (!turnKeyId || !turnApiToken) {
      throw new TurnServiceError("TURN configuration missing");
    }

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl: 86400,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();

      throw new TurnServiceError(
        `Failed to generate TURN credentials: ${response.status} ${error}`,
        502,
      );
    }

    return response.json();
  }

  async getCachedUsage(from: Date, to: Date = new Date()): Promise<CloudflareTurnUsage> {
    const now = Date.now();

    if (this.cachedTurnUsage && now < this.cacheExpiresAt) {
      return this.cachedTurnUsage;
    }

    if (this.inFlightRequest) {
      return this.inFlightRequest;
    }

    this.inFlightRequest = this.getUsage(from, to);

    try {
      const usage = await this.inFlightRequest;

      this.cachedTurnUsage = usage;
      this.cacheExpiresAt = Date.now() + TURN_USAGE_CACHE_TTL;

      return usage;
    } catch (error) {
      // Analytics unavailable? Prefer an old value over failing completely.
      if (this.cachedTurnUsage) {
        console.warn(
          "Cloudflare analytics failed; using stale TURN usage cache",
          error,
        );
        return this.cachedTurnUsage;
      }

      throw error;
    } finally {
      this.inFlightRequest = null;
    }
  }

  private async getUsage(from: Date, to: Date = new Date()): Promise<CloudflareTurnUsage> {
    const accountId = env.cloudflareAccountId;
    const apiToken = env.cloudflareAnalyticsApiToken;

    if (!accountId) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is missing");
    }

    if (!apiToken) {
      throw new Error("CLOUDFLARE_ANALYTICS_API_TOKEN is missing");
    }

    const dateFrom = toDateString(from);
    const dateTo = toDateString(to);

    const query = `
      query TurnUsage {
        viewer {
          accounts(
            filter: {
              accountTag: "${accountId}"
            }
          ) {
            callsTurnUsageAdaptiveGroups(
              limit: 1
              filter: {
                date_geq: "${dateFrom}"
                date_leq: "${dateTo}"
              }
            ) {
              sum {
                egressBytes
                ingressBytes
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      "https://api.cloudflare.com/client/v4/graphql",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Cloudflare analytics request failed: ${response.status} ${body}`,
      );
    }

    const result = (await response.json()) as CloudflareGraphQlResponse;

    if (result.errors?.length) {
      throw new Error(
        `Cloudflare GraphQL error: ${result.errors
          .map((error) => error.message)
          .join(", ")}`,
      );
    }

    const sum =
      result.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups?.[0]?.sum;

    const egressBytes = sum?.egressBytes ?? 0;
    const ingressBytes = sum?.ingressBytes ?? 0;

    // Cloudflare prices in decimal GB: 1 GB = 1,000,000,000 bytes
    const egressGB = egressBytes / 1_000_000_000;
    const ingressGB = ingressBytes / 1_000_000_000;

    // Cloudflare Realtime free allowance: 1000 GB egress.
    const freeTierPercent = (egressGB / 1000) * 100;

    return {
      from: dateFrom,
      to: dateTo,
      egressBytes,
      ingressBytes,
      egressGB,
      ingressGB,
      freeTierPercent,
    };
  }
}