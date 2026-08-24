import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { TurnService, TurnServiceError } from "../src/services/turn.service.js";

const envKeys = [
  "CLOUDFLARE_TURN_KEY_ID",
  "CLOUDFLARE_TURN_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ANALYTICS_API_TOKEN",
  "CLOUDFLARE_TURN_SWITCH_GB",
  "EXPRESSTURN_URLS",
  "EXPRESSTURN_USERNAME",
  "EXPRESSTURN_CREDENTIAL",
  "EXPRESSTURN_DISABLED",
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;

  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureProviders(): void {
  process.env.CLOUDFLARE_TURN_KEY_ID = "cloudflare-key";
  process.env.CLOUDFLARE_TURN_API_TOKEN = "cloudflare-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_ANALYTICS_API_TOKEN = "analytics-token";
  process.env.CLOUDFLARE_TURN_SWITCH_GB = "950";
  process.env.EXPRESSTURN_URLS = "turn:free.expressturn.com:3478";
  process.env.EXPRESSTURN_USERNAME = "express-user";
  process.env.EXPRESSTURN_CREDENTIAL = "express-password";
  delete process.env.EXPRESSTURN_DISABLED;
}

function usageResponse(egressGB: number): Response {
  return Response.json({
    data: {
      viewer: {
        accounts: [{
          callsTurnUsageAdaptiveGroups: [{
            sum: {
              egressBytes: egressGB * 1_000_000_000,
              ingressBytes: 0,
            },
          }],
        }],
      },
    },
  });
}

test("uses Cloudflare below the monthly switch threshold", async () => {
  configureProviders();
  const requests: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);

    if (url.includes("graphql")) return usageResponse(949.99);

    return Response.json({
      iceServers: [{
        urls: "turn:turn.cloudflare.com:3478",
        username: "temporary-user",
        credential: "temporary-password",
      }],
    });
  };

  const result = await new TurnService().generateIceServers(
    new Date("2026-08-24T12:00:00Z"),
  );

  assert.equal(requests.length, 2);
  assert.match(String(result.iceServers[0]?.urls), /cloudflare/);
});

test("switches to ExpressTURN at 950 GB", async () => {
  configureProviders();
  let requestCount = 0;

  globalThis.fetch = async () => {
    requestCount += 1;
    return usageResponse(950);
  };

  const result = await new TurnService().generateIceServers(
    new Date("2026-08-24T12:00:00Z"),
  );

  assert.equal(requestCount, 1);
  assert.deepEqual(result.iceServers, [{
    urls: ["turn:free.expressturn.com:3478"],
    username: "express-user",
    credential: "express-password",
  }]);
});

test("fails over to ExpressTURN when analytics is unavailable", async () => {
  configureProviders();
  globalThis.fetch = async () => {
    throw new Error("analytics offline");
  };

  const result = await new TurnService().generateIceServers();
  assert.equal(result.iceServers[0]?.username, "express-user");
});

test("returns TURN_UNAVAILABLE when ExpressTURN is disabled", async () => {
  configureProviders();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  process.env.EXPRESSTURN_DISABLED = "true";

  await assert.rejects(
    new TurnService().generateIceServers(),
    (error: unknown) => error instanceof TurnServiceError
      && error.status === 503
      && error.code === "TURN_UNAVAILABLE",
  );
});
