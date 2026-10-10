import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, test } from "node:test";
import { CatalogService } from "../src/services/catalog.service.js";

const originalLimits = {
  MAX_ROOMS_PER_DEVICE: process.env.MAX_ROOMS_PER_DEVICE,
  MAX_MEMBERS_PER_ROOM: process.env.MAX_MEMBERS_PER_ROOM,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalLimits)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("removes only profiles without memberships after the configured retention", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const staleProfileId = randomUUID();
  const retainedProfileId = randomUUID();
  const roomId = `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

  try {
    await pool.query(
      "INSERT INTO guest_profiles (id, name) VALUES ($1, 'Stale profile'), ($2, 'Member profile')",
      [staleProfileId, retainedProfileId],
    );
    await pool.query("INSERT INTO rooms (id, name) VALUES ($1, 'Retention test room')", [roomId]);
    await pool.query(
      "INSERT INTO room_memberships (user_id, room_id, owner) VALUES ($1, $2, false)",
      [retainedProfileId, roomId],
    );
    await pool.query(
      "UPDATE guest_profiles SET last_seen_at = now() - interval '91 days' WHERE id = ANY($1::uuid[])",
      [[staleProfileId, retainedProfileId]],
    );

    const removed = await new CatalogService(pool).cleanupUnusedProfiles(90);
    assert.ok(removed.includes(staleProfileId));
    assert.ok(!removed.includes(retainedProfileId));
    const retained = await pool.query("SELECT 1 FROM guest_profiles WHERE id = $1", [retainedProfileId]);
    assert.equal(retained.rowCount, 1);
  } finally {
    await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
    await pool.query("DELETE FROM guest_profiles WHERE id = ANY($1::uuid[])", [[staleProfileId, retainedProfileId]]);
    await pool.end();
  }
});

test("enforces persisted room and membership caps atomically", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  process.env.MAX_ROOMS_PER_DEVICE = "1";
  process.env.MAX_MEMBERS_PER_ROOM = "1";
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const catalog = new CatalogService(pool);
  const roomId = `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const secondRoomId = `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  let ownerUserId: string | undefined;

  try {
    const owner = await catalog.createOwnedRoom(roomId, "Owner");
    ownerUserId = owner.userId;
    await assert.rejects(
      catalog.createOwnedRoom(secondRoomId, undefined, owner.deviceToken),
      (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 409),
    );

    const generation = await catalog.getGeneration(roomId);
    assert.ok(generation);
    await assert.rejects(
      catalog.joinByInvite(roomId, generation, "Guest"),
      (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 409),
    );
  } finally {
    await pool.query("DELETE FROM rooms WHERE id = ANY($1::varchar[])", [[roomId, secondRoomId]]);
    if (ownerUserId) await pool.query("DELETE FROM guest_profiles WHERE id = $1", [ownerUserId]);
    await pool.end();
  }
});

test("shares and releases expiring WebSocket connection leases across catalog instances", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const firstCatalog = new CatalogService(pool);
  const secondCatalog = new CatalogService(pool);
  const clientIp = `lease-test-${randomUUID()}`;
  let leaseId: string | null = null;

  try {
    leaseId = await firstCatalog.acquireWebSocketConnection(clientIp, 1);
    assert.ok(leaseId);
    assert.equal(await secondCatalog.acquireWebSocketConnection(clientIp, 1), null);
    assert.equal(await secondCatalog.renewWebSocketConnection(leaseId), true);
    await firstCatalog.releaseWebSocketConnection(leaseId);
    leaseId = null;
    const nextLease = await secondCatalog.acquireWebSocketConnection(clientIp, 1);
    assert.ok(nextLease);
    leaseId = nextLease;
  } finally {
    if (leaseId) await firstCatalog.releaseWebSocketConnection(leaseId);
    await pool.end();
  }
});
