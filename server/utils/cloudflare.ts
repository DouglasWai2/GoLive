type CloudflareGraphQlResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        callsTurnUsageAdaptiveGroups?: Array<{
          sum?: {
            egressBytes?: number;
            ingressBytes?: number;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
};

export type CloudflareTurnUsage = {
  from: string;
  to: string;

  egressBytes: number;
  ingressBytes: number;

  egressGB: number;
  ingressGB: number;

  freeTierPercent: number;
};

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

let cachedTurnUsage: CloudflareTurnUsage | null = null;
let cacheExpiresAt = 0;
let inFlightRequest: Promise<CloudflareTurnUsage> | null = null;

const TURN_USAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
export async function getCachedCloudflareTurnUsage(
  from: Date,
  to: Date = new Date(),
): Promise<CloudflareTurnUsage> {
  const now = Date.now();

  // Return cached result if still valid
  if (
    cachedTurnUsage &&
    now < cacheExpiresAt
  ) {
    console.log("Returning cached TURN usage");
    return cachedTurnUsage;
  }

  // If another request is already fetching usage,
  // reuse that same promise
  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = getCloudflareTurnUsage(
    from,
    to,
  );

  try {
    const usage =
      await inFlightRequest;

    cachedTurnUsage = usage;

    cacheExpiresAt =
      Date.now() +
      TURN_USAGE_CACHE_TTL;

    return usage;
  } finally {
    inFlightRequest = null;
  }
}

export async function getCloudflareTurnUsage(
  from: Date,
  to: Date = new Date(),
): Promise<CloudflareTurnUsage> {
  
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID;

  const apiToken =
    process.env.CLOUDFLARE_ANALYTICS_API_TOKEN;

  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID is missing",
    );
  }

  if (!apiToken) {
    throw new Error(
      "CLOUDFLARE_ANALYTICS_API_TOKEN is missing",
    );
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

      body: JSON.stringify({
        query,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Cloudflare analytics request failed: ${response.status} ${body}`,
    );
  }

  const result =
    (await response.json()) as CloudflareGraphQlResponse;

  if (result.errors?.length) {
    throw new Error(
      `Cloudflare GraphQL error: ${result.errors
        .map((error) => error.message)
        .join(", ")}`,
    );
  }

  const usage =
    result.data?.viewer?.accounts?.[0]
      ?.callsTurnUsageAdaptiveGroups?.[0]
      ?.sum;

  const egressBytes =
    usage?.egressBytes ?? 0;

  const ingressBytes =
    usage?.ingressBytes ?? 0;

  /*
   * Cloudflare prices in decimal GB:
   * 1 GB = 1,000,000,000 bytes
   */
  const egressGB =
    egressBytes / 1_000_000_000;

  const ingressGB =
    ingressBytes / 1_000_000_000;

  /*
   * Cloudflare Realtime free allowance:
   * 1000 GB egress.
   */
  const freeTierPercent =
    (egressGB / 1000) * 100;

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