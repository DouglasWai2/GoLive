import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { afterEach, test } from "node:test";
import { buildApp } from "../src/app.js";

const environmentKeys = ["DATABASE_URL", "TRUST_PROXY", "ADMIN_SECRET", "JWT_SECRET"] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("shares HTTP rate-limit counters across server instances", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.TRUST_PROXY = "1";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";

  const first = await buildApp();
  const second = await buildApp();
  const clientIp = `198.51.100.${randomInt(1, 255)}`;
  const options = {
    method: "POST" as const,
    url: "/admin/login",
    headers: { "x-forwarded-for": clientIp },
    payload: { secret: "wrong-secret" },
  };

  try {
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await first.inject(options)).statusCode, 401);
    }
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await second.inject(options)).statusCode, 401);
    }
    assert.equal((await second.inject(options)).statusCode, 429);
  } finally {
    await first.close();
    await second.close();
  }
});
