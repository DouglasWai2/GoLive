import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildApp } from "../src/app.js";

const envKeys = ["ADMIN_SECRET", "JWT_SECRET"] as const;
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

function configureAdmin(): void {
  process.env.ADMIN_SECRET = "dashboard-secret";
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
}

test("admin login fails closed without both explicit secrets", async () => {
  delete process.env.ADMIN_SECRET;
  delete process.env.JWT_SECRET;
  const app = await buildApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/admin/login",
      payload: { secret: "anything" },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "Admin unavailable" });
  } finally {
    await app.close();
  }
});

test("admin login rejects wrong and oversized secrets and signs an admin token", async () => {
  configureAdmin();
  const app = await buildApp();

  try {
    const wrong = await app.inject({
      method: "POST",
      url: "/admin/login",
      payload: { secret: "wrong-secret" },
    });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(wrong.json(), { error: "Unauthorized" });

    const oversized = await app.inject({
      method: "POST",
      url: "/admin/login",
      payload: { secret: "x".repeat(1025) },
    });
    assert.equal(oversized.statusCode, 400);

    const correct = await app.inject({
      method: "POST",
      url: "/admin/login",
      payload: { secret: "dashboard-secret" },
    });
    assert.equal(correct.statusCode, 200);
    const body = correct.json<{ token: string; expiresInSeconds: number }>();
    assert.equal(body.expiresInSeconds, 3600);
    const payload = app.jwt.verify<Record<string, unknown>>(body.token);
    assert.equal(payload.kind, "admin");
    assert.equal(payload.secret, undefined);
    assert.equal((payload.exp as number) - (payload.iat as number), 3600);
  } finally {
    await app.close();
  }
});

test("room JWTs cannot access admin overview", async () => {
  configureAdmin();
  const app = await buildApp();

  try {
    const roomToken = app.jwt.sign({
      kind: "room",
      sessionId: "session",
      roomId: "room-id",
      name: "User",
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/overview",
      headers: { authorization: `Bearer ${roomToken}` },
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  } finally {
    await app.close();
  }
});

test("admin overview returns finite process-local metrics and sanitized rooms", async () => {
  configureAdmin();
  const app = await buildApp();

  try {
    const token = app.jwt.sign({ kind: "admin" }, { expiresIn: 3600 });
    const response = await app.inject({
      method: "GET",
      url: "/admin/overview",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, any>>();
    assert.equal(body.scope, "process");
    assert.deepEqual(body.summary, {
      activeRooms: 0,
      activeUsers: 0,
      activeSharers: 0,
    });
    assert.deepEqual(body.rooms, []);
    assert.match(body.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(body.serverStartedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Number.isFinite(body.system.process.cpuPercent));
    assert.ok(body.system.process.cpuPercent >= 0);
    assert.ok(body.system.process.cpuPercent <= 100);
    assert.ok(Number.isFinite(body.system.host.cpuPercent));
    assert.doesNotMatch(JSON.stringify(body.rooms), /socket|sessionId|secret/);
  } finally {
    await app.close();
  }
});

test("TURN usage validates actual bounded UTC date ranges before fetching", async () => {
  configureAdmin();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("network should not be called");
  };
  const app = await buildApp();

  try {
    const token = app.jwt.sign({ kind: "admin" }, { expiresIn: 3600 });
    const headers = { authorization: `Bearer ${token}` };
    const urls = [
      "/admin/turn-usage?from=2026-02-30&to=2026-03-01",
      "/admin/turn-usage?from=2026-08-02&to=2026-08-01",
      "/admin/turn-usage?from=2999-01-01&to=2999-01-02",
      "/admin/turn-usage?from=2020-01-01&to=2021-01-01",
      "/admin/turn-usage?from=not-a-date&to=2026-01-01",
    ];

    for (const url of urls) {
      const response = await app.inject({ method: "GET", url, headers });
      assert.equal(response.statusCode, 400, url);
      assert.deepEqual(response.json(), { error: "Invalid date range" });
    }
    assert.equal(fetchCount, 0);
  } finally {
    await app.close();
  }
});
