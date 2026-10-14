import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createNeonAuthVerifier } from "../src/services/neon-auth.service.js";

test("verifies Neon Auth tokens against the configured issuer, audience, and JWKS", async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "EdDSA", use: "sig" };
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=60" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const verifier = createNeonAuthVerifier(`${origin}/neondb/auth`, `${origin}/jwks`);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
      .setIssuer(origin)
      .setAudience(origin)
      .setSubject("auth-user-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    assert.deepEqual(await verifier(token), { id: "auth-user-123" });
    assert.equal(await verifier("not-a-jwt"), null);

    const wrongIssuer = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
      .setIssuer("https://wrong.example")
      .setAudience(origin)
      .setSubject("auth-user-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    assert.equal(await verifier(wrongIssuer), null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("does not silently treat invalid account credentials as a guest room create", async () => {
  const original = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED,
  };
  delete process.env.DATABASE_URL;
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
  process.env.GOOGLE_AUTH_ENABLED = "true";

  try {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp({
      verifyNeonAuth: async (token) => token === "valid-test-token" ? { id: "auth-user-123" } : null,
    });
    try {
      const invalid = await app.inject({
        method: "POST",
        url: "/room",
        headers: { authorization: "Bearer forged-token" },
        payload: { roomId: "auth_test_invalid", name: "User" },
      });
      assert.equal(invalid.statusCode, 401);

      const validWithoutDatabase = await app.inject({
        method: "POST",
        url: "/room",
        headers: { authorization: "Bearer valid-test-token" },
        payload: { roomId: "auth_test_db_missing", name: "User" },
      });
      assert.equal(validWithoutDatabase.statusCode, 503);

      const guest = await app.inject({
        method: "POST",
        url: "/room",
        payload: { roomId: "auth_test_guest", name: "Guest" },
      });
      assert.equal(guest.statusCode, 200);
    } finally {
      await app.close();
    }
  } finally {
    if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original.DATABASE_URL;
    if (original.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original.JWT_SECRET;
    if (original.GOOGLE_AUTH_ENABLED === undefined) delete process.env.GOOGLE_AUTH_ENABLED;
    else process.env.GOOGLE_AUTH_ENABLED = original.GOOGLE_AUTH_ENABLED;
  }
});
