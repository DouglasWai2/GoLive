import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("CORS preflight allows leaving a room from the web origin", async () => {
  const original = {
    JWT_SECRET: process.env.JWT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    ORIGIN: process.env.ORIGIN,
  };
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
  delete process.env.DATABASE_URL;
  process.env.ORIGIN = "https://example.com";

  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    app = await buildApp();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/device/room",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "https://example.com");
    assert.match(String(response.headers["access-control-allow-methods"]), /(?:^|,\s*)DELETE(?:,|$)/);
    assert.match(String(response.headers["access-control-allow-headers"]), /authorization/i);
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
