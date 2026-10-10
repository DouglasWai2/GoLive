import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchNeonAuthToken, NeonAuthTokenError } from "../src/neonAuth";

test("fetches the Neon access token from the Auth endpoint without using client cache", async () => {
  let requestUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const token = await fetchNeonAuthToken(
    "https://auth.example.com/neondb/auth/",
    async (input, init) => {
      requestUrl = new URL(String(input));
      requestInit = init;
      return new Response(JSON.stringify({ token: "neon-access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  assert.equal(token, "neon-access-token");
  assert.equal(requestUrl?.toString(), "https://auth.example.com/neondb/auth/token");
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.credentials, "include");
  assert.equal(requestInit?.cache, "no-store");
});

test("reports a missing Neon session instead of returning an empty account token", async () => {
  await assert.rejects(
    fetchNeonAuthToken("https://auth.example.com/neondb/auth", async () =>
      new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })),
    (error: unknown) => error instanceof NeonAuthTokenError
      && error.status === 401
      && error.message.includes("Sign in with Google again"),
  );
});

test("rejects a successful response that does not contain a token", async () => {
  await assert.rejects(
    fetchNeonAuthToken("https://auth.example.com/neondb/auth", async () =>
      new Response(JSON.stringify({}), { status: 200 })),
    (error: unknown) => error instanceof NeonAuthTokenError
      && error.status === 502
      && error.message.includes("returned no access token"),
  );
});
