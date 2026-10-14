import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("Google account tokens are rejected when authentication is disabled", async () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  process.env.NODE_ENV = "production";
  delete process.env.GOOGLE_AUTH_ENABLED;
  delete process.env.DATABASE_URL;
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";

  try {
    const verifier = async () => ({ id: "account-owner" });
    const app = await buildApp({ verifyNeonAuth: verifier });
    try {
      const account = await app.inject({
        method: "POST", url: "/room",
        headers: { authorization: "Bearer valid-account-token" },
        payload: { roomId: "auth_disabled_room", name: "Owner" },
      });
      assert.equal(account.statusCode, 401);
      const guest = await app.inject({
        method: "POST", url: "/room", payload: { roomId: "guest_enabled_room", name: "Guest" },
      });
      assert.equal(guest.statusCode, 200);
    } finally {
      await app.close();
    }

    process.env.NODE_ENV = "development";
    process.env.GOOGLE_AUTH_ENABLED = "false";
    const disabledInDevelopment = await buildApp({ verifyNeonAuth: verifier });
    try {
      const account = await disabledInDevelopment.inject({
        method: "POST", url: "/room",
        headers: { authorization: "Bearer valid-account-token" },
        payload: { roomId: "auth_explicitly_disabled", name: "Owner" },
      });
      assert.equal(account.statusCode, 401);
    } finally {
      await disabledInDevelopment.close();
    }

    process.env.NODE_ENV = "production";
    process.env.GOOGLE_AUTH_ENABLED = "true";
    const enabledInProduction = await buildApp({ verifyNeonAuth: verifier });
    try {
      const account = await enabledInProduction.inject({
        method: "POST", url: "/room",
        headers: { authorization: "Bearer valid-account-token" },
        payload: { roomId: "auth_explicitly_enabled", name: "Owner" },
      });
      assert.equal(account.statusCode, 503); // Token accepted; account rooms require a database.
    } finally {
      await enabledInProduction.close();
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
