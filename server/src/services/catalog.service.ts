import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizeIP } from "@fastify/rate-limit";
import type { Pool, PoolClient } from "pg";
import { env } from "../config/env.js";

export type StoredRoom = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type GuestProfile = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type RoomRow = { id: string; name: string; created_at: Date; updated_at: Date };
type ProfileRow = RoomRow;

export type DeviceMembership = {
  userId: string;
  roomId: string;
  name: string;
  owner: boolean;
};

export type Enrollment = DeviceMembership & { deviceToken: string; replacedRoomIds?: string[] };

export type DeviceRoom = StoredRoom & { owner: boolean };

type ResolvedDevice = {
  id: string;
  name: string;
  auth_user_id: string | null;
  guest_room_id: string | null;
};

export class CatalogError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const DEVICE_TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;
const MAX_CATALOG_PAGE_SIZE = 100;
const MAX_CATALOG_OFFSET = 100_000;

function validateCatalogPage(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CATALOG_PAGE_SIZE) {
    throw new RangeError(`limit must be between 1 and ${MAX_CATALOG_PAGE_SIZE}`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_CATALOG_OFFSET) {
    throw new RangeError(`offset must be between 0 and ${MAX_CATALOG_OFFSET}`);
  }
}

function tokenHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const value = await action(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

function room(row: RoomRow): StoredRoom {
  return { id: row.id, name: row.name, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

function profile(row: ProfileRow): GuestProfile {
  return { id: row.id, name: row.name, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

export class CatalogService {
  constructor(private readonly pool: Pool) {}

  private async resolveDevice(
    client: PoolClient,
    deviceToken: string,
    lock = false,
    authUserId?: string,
  ): Promise<ResolvedDevice | null> {
    const match = DEVICE_TOKEN_PATTERN.exec(deviceToken);
    if (!match) return null;
    const result = await client.query<ResolvedDevice & { credential_hash: string; needs_touch: boolean }>(
      `SELECT id, name, credential_hash, auth_user_id, guest_room_id,
         last_seen_at < now() - interval '1 day' AS needs_touch
       FROM guest_profiles WHERE id = $1 ${lock || authUserId ? "FOR UPDATE" : ""}`,
      [match[1]],
    );
    const user = result.rows[0];
    if (user?.credential_hash !== tokenHash(match[2]!)) return null;

    // Touch at most once per day so routine device checks do not write on every request.
    if (user.needs_touch) {
      const touched = await client.query(
        `UPDATE guest_profiles SET last_seen_at = now()
         WHERE id = $1 AND last_seen_at < now() - interval '1 day'
         RETURNING id`,
        [user.id],
      );
      if (!touched.rowCount) {
        const stillExists = await client.query("SELECT 1 FROM guest_profiles WHERE id = $1", [user.id]);
        if (!stillExists.rowCount) return null;
      }
    }
    if (authUserId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`golive:room-owner:${authUserId}`]);
      if (user.auth_user_id && user.auth_user_id !== authUserId) {
        throw new CatalogError(403, "This device profile is linked to a different Google account.");
      }
      if (!user.auth_user_id) {
        await client.query("UPDATE guest_profiles SET auth_user_id = $2 WHERE id = $1", [user.id, authUserId]);
        user.auth_user_id = authUserId;
      }
    }
    return user;
  }

  async getDeviceAuthUserId(deviceToken: string): Promise<string | null> {
    const match = DEVICE_TOKEN_PATTERN.exec(deviceToken);
    if (!match) throw new CatalogError(401, "Invalid device credential");
    const result = await this.pool.query<{ credential_hash: string; auth_user_id: string | null }>(
      "SELECT credential_hash, auth_user_id FROM guest_profiles WHERE id = $1", [match[1]],
    );
    const profile = result.rows[0];
    if (!profile || profile.credential_hash !== tokenHash(match[2]!)) {
      throw new CatalogError(401, "Invalid device credential");
    }
    return profile.auth_user_id;
  }

  private async guestRoomForDevice(
    client: PoolClient,
    user: { id: string; auth_user_id: string | null; guest_room_id: string | null },
    authUserId?: string,
  ): Promise<string | null> {
    if (authUserId) return null;
    if (user.auth_user_id) return user.guest_room_id;
    if (user.guest_room_id) return user.guest_room_id;

    // Older guest profiles may not have a current-room pointer yet.
    const result = await client.query<{ room_id: string }>(
      `SELECT room_memberships.room_id
       FROM room_memberships
       JOIN rooms ON rooms.id = room_memberships.room_id
       WHERE room_memberships.user_id = $1
       ORDER BY rooms.created_at DESC, rooms.id LIMIT 1`,
      [user.id],
    );
    return result.rows[0]?.room_id ?? null;
  }

  async getMembership(deviceToken: string, authUserId?: string): Promise<DeviceMembership | null> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, false, authUserId);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const guestRoomId = await this.guestRoomForDevice(client, user, authUserId);
      const result = await client.query<{ room_id: string; owner: boolean }>(
        `SELECT room_memberships.room_id, room_memberships.owner
         FROM room_memberships
         JOIN rooms ON rooms.id = room_memberships.room_id
         WHERE room_memberships.user_id = $1
           AND CASE WHEN $2::varchar IS NOT NULL
             THEN (room_memberships.owner = false OR rooms.owner_auth_user_id = $2)
             ELSE room_memberships.room_id = $3
           END
         ORDER BY rooms.created_at DESC, rooms.id LIMIT 1`,
        [user.id, authUserId ?? null, guestRoomId],
      );
      const member = result.rows[0];
      return member ? { userId: user.id, roomId: member.room_id, name: user.name, owner: member.owner } : null;
    });
  }

  async listDeviceRooms(deviceToken: string, authUserId?: string): Promise<DeviceRoom[]> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, false, authUserId);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const guestRoomId = await this.guestRoomForDevice(client, user, authUserId);
      const result = await client.query<RoomRow & { owner: boolean }>(
        `SELECT rooms.id, rooms.name, rooms.created_at, rooms.updated_at, room_memberships.owner
         FROM room_memberships
         JOIN rooms ON rooms.id = room_memberships.room_id
           WHERE room_memberships.user_id = $1
             AND CASE WHEN $2::varchar IS NOT NULL
               THEN (room_memberships.owner = false OR rooms.owner_auth_user_id = $2)
               ELSE room_memberships.room_id = $3
             END
           ORDER BY rooms.created_at DESC, rooms.id`,
        [user.id, authUserId ?? null, guestRoomId],
      );
      return result.rows.map((row) => ({ ...room(row), owner: row.owner }));
    });
  }

  async listOwnedRooms(authUserId: string): Promise<DeviceRoom[]> {
    const result = await this.pool.query<RoomRow>(
      `SELECT id, name, created_at, updated_at FROM rooms
       WHERE owner_auth_user_id = $1 AND empty_since IS NULL
       ORDER BY created_at DESC, id LIMIT $2`,
      [authUserId, MAX_CATALOG_PAGE_SIZE],
    );
    return result.rows.map((row) => ({ ...room(row), owner: true }));
  }

  async endOwnedRoom(authUserId: string, roomId: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`golive:room-owner:${authUserId}`]);
      const result = await client.query(
        "DELETE FROM rooms WHERE id = $1 AND owner_auth_user_id = $2 RETURNING id",
        [roomId, authUserId],
      );
      return Boolean(result.rowCount);
    });
  }

  async getDeviceMembership(deviceToken: string, roomId: string, authUserId?: string): Promise<DeviceMembership | null> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, false, authUserId);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const guestRoomId = await this.guestRoomForDevice(client, user, authUserId);
      const result = await client.query<{ owner: boolean }>(
        `SELECT room_memberships.owner FROM room_memberships
         JOIN rooms ON rooms.id = room_memberships.room_id
         WHERE user_id = $1 AND room_id = $2
           AND CASE WHEN $3::varchar IS NOT NULL
             THEN (room_memberships.owner = false OR rooms.owner_auth_user_id = $3)
             ELSE room_memberships.room_id = $4
           END`,
        [user.id, roomId, authUserId ?? null, guestRoomId],
      );
      const member = result.rows[0];
      return member ? { userId: user.id, roomId, name: user.name, owner: member.owner } : null;
    });
  }

  async getUserMembership(userId: string, roomId: string): Promise<DeviceMembership | null> {
    const result = await this.pool.query<{ name: string; owner: boolean }>(
      `SELECT guest_profiles.name, room_memberships.owner
       FROM room_memberships
       JOIN guest_profiles ON guest_profiles.id = room_memberships.user_id
       WHERE room_memberships.user_id = $1 AND room_memberships.room_id = $2`,
      [userId, roomId],
    );
    const member = result.rows[0];
    return member ? { userId, roomId, name: member.name, owner: member.owner } : null;
  }

  async getDeviceProfile(deviceToken: string, authUserId?: string): Promise<GuestProfile> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, false, authUserId);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const result = await client.query<ProfileRow>(
        "SELECT id, name, created_at, updated_at FROM guest_profiles WHERE id = $1",
        [user.id],
      );
      return profile(result.rows[0]!);
    });
  }

  async updateDeviceProfile(deviceToken: string, name: string, authUserId?: string): Promise<{ userId: string; profile: GuestProfile }> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, true, authUserId);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const result = await client.query<ProfileRow>(
        `UPDATE guest_profiles SET name = $2, updated_at = now()
         WHERE id = $1 RETURNING id, name, created_at, updated_at`,
        [user.id, name.trim()],
      );
      return { userId: user.id, profile: profile(result.rows[0]!) };
    });
  }

  async isMember(userId: string, roomId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM room_memberships WHERE user_id = $1 AND room_id = $2", [userId, roomId],
    );
    return Boolean(result.rowCount);
  }

  async getGeneration(roomId: string): Promise<string | null> {
    const result = await this.pool.query<{ generation: string }>("SELECT generation FROM rooms WHERE id = $1", [roomId]);
    return result.rows[0]?.generation ?? null;
  }

  async createOwnedRoom(
    roomId: string,
    name: string | undefined,
    deviceToken?: string,
    authUserId?: string,
  ): Promise<Enrollment> {
    return transaction(this.pool, async (client) => {
      if (authUserId) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`golive:room-owner:${authUserId}`]);
      }

      let user = deviceToken ? await this.resolveDevice(client, deviceToken, true, authUserId) : null;
      if (deviceToken && !user) throw new CatalogError(401, "Invalid device credential");

      const ownedRoom = authUserId
        ? await client.query<{ owner_auth_user_id: string | null; empty_since: Date | null }>(
          "SELECT owner_auth_user_id, empty_since FROM rooms WHERE id = $1", [roomId],
        )
        : null;
      const existingRoom = ownedRoom?.rows[0];
      if (existingRoom && existingRoom.owner_auth_user_id !== authUserId) {
        throw new CatalogError(403, "This room requires an invite to join.");
      }

      if (authUserId && (!existingRoom || existingRoom.empty_since !== null)) {
        const active = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM rooms WHERE owner_auth_user_id = $1 AND empty_since IS NULL",
          [authUserId],
        );
        if (Number(active.rows[0]?.count ?? 0) >= 5) {
          throw new CatalogError(409, "You already have five active rooms. End one before creating another.");
        }
      }

      const trimmedName = name?.trim();
      if (!user && !trimmedName) throw new CatalogError(400, "Name is required");
      if (user) {
        const alreadyMember = existingRoom ? await client.query(
          "SELECT 1 FROM room_memberships WHERE user_id = $1 AND room_id = $2", [user.id, roomId],
        ) : null;
        if (!alreadyMember?.rowCount) {
          const count = await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM room_memberships WHERE user_id = $1",
            [user.id],
          );
          if (Number(count.rows[0]?.count ?? 0) >= env.maxRoomsPerDevice) {
            throw new CatalogError(409, "Device room limit reached");
          }
        }
      }
      let replacedRoomIds: string[] = [];
      if (user && !authUserId) {
        if (user.auth_user_id) {
          const existing = await client.query<{ room_id: string }>(
            "SELECT room_id FROM room_memberships WHERE user_id = $1", [user.id],
          );
          replacedRoomIds = existing.rows.map((row) => row.room_id);
          if (user.guest_room_id) {
            const removed = await client.query<{ room_id: string }>(
              "DELETE FROM room_memberships WHERE user_id = $1 AND room_id = $2 RETURNING room_id",
              [user.id, user.guest_room_id],
            );
            for (const replacedRoomId of removed.rows.map((row) => row.room_id)) {
              await this.markEmptyRoom(client, replacedRoomId);
            }
          }
        } else {
          const removed = await client.query<{ room_id: string }>(
            "DELETE FROM room_memberships WHERE user_id = $1 RETURNING room_id",
            [user.id],
          );
          replacedRoomIds = removed.rows.map((row) => row.room_id);
          for (const replacedRoomId of replacedRoomIds) await this.markEmptyRoom(client, replacedRoomId);
        }
      }
      if (!existingRoom) {
        const created = await client.query(
          `INSERT INTO rooms (id, name, owner_auth_user_id)
           VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [roomId, `Room ${roomId}`, authUserId ?? null],
        );
        if (!created.rowCount) throw new CatalogError(403, "This room requires an invite to join.");
      }
      let issuedToken = deviceToken;
      if (!user) {
        const id = randomUUID();
        const secret = randomBytes(32).toString("base64url");
        issuedToken = `${id}.${secret}`;
        await client.query(
          "INSERT INTO guest_profiles (id, name, credential_hash, auth_user_id, guest_room_id) VALUES ($1, $2, $3, $4, $5)",
          [id, trimmedName, tokenHash(secret), authUserId ?? null, authUserId ? null : roomId],
        );
        user = { id, name: trimmedName!, auth_user_id: authUserId ?? null, guest_room_id: authUserId ? null : roomId };
      }
      await client.query(
        `INSERT INTO room_memberships (user_id, room_id, owner) VALUES ($1, $2, true)
         ON CONFLICT (user_id, room_id) DO UPDATE SET owner = true`,
        [user.id, roomId],
      );
      await client.query("UPDATE rooms SET empty_since = NULL WHERE id = $1", [roomId]);
      if (!authUserId) {
        await client.query("UPDATE guest_profiles SET guest_room_id = $2 WHERE id = $1", [user.id, roomId]);
      }
      return {
        userId: user.id,
        roomId,
        name: user.name,
        owner: true,
        deviceToken: issuedToken!,
        ...(replacedRoomIds.length ? { replacedRoomIds } : {}),
      };
    });
  }

  async joinByInvite(
    roomId: string,
    generation: string,
    name: string | undefined,
    deviceToken?: string,
    authUserId?: string,
  ): Promise<Enrollment> {
    return transaction(this.pool, async (client) => {
      let user = deviceToken ? await this.resolveDevice(client, deviceToken, true, authUserId) : null;
      if (deviceToken && !user) throw new CatalogError(401, "Invalid device credential");
      // Lock the room so deletion and enrollment cannot race.
      const room = await client.query("SELECT 1 FROM rooms WHERE id = $1 AND generation = $2 FOR UPDATE", [roomId, generation]);
      if (!room.rowCount) throw new CatalogError(403, "Invite does not match this room.");

      const existingMembership = user
        ? await client.query(
          "SELECT 1 FROM room_memberships WHERE user_id = $1 AND room_id = $2",
          [user.id, roomId],
        )
        : { rowCount: 0 };
      if (!existingMembership.rowCount) {
        const roomCount = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM room_memberships WHERE room_id = $1",
          [roomId],
        );
        if (Number(roomCount.rows[0]?.count ?? 0) >= env.maxMembersPerRoom) {
          throw new CatalogError(409, "Room membership limit reached");
        }
        if (user) {
          const deviceCount = await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM room_memberships WHERE user_id = $1",
            [user.id],
          );
          if (Number(deviceCount.rows[0]?.count ?? 0) >= env.maxRoomsPerDevice) {
            throw new CatalogError(409, "Device room limit reached");
          }
        }
      }

      let issuedToken = deviceToken;
      if (!user) {
        const trimmedName = name?.trim();
        if (!trimmedName) throw new CatalogError(400, "Name is required");
        const id = randomUUID();
        const secret = randomBytes(32).toString("base64url");
        issuedToken = `${id}.${secret}`;
        await client.query(
          "INSERT INTO guest_profiles (id, name, credential_hash, auth_user_id, guest_room_id) VALUES ($1, $2, $3, $4, $5)",
          [id, trimmedName, tokenHash(secret), authUserId ?? null, authUserId ? null : roomId],
        );
        user = { id, name: trimmedName, auth_user_id: authUserId ?? null, guest_room_id: authUserId ? null : roomId };
      }
      let replacedRoomIds: string[] = [];
      if (!authUserId) {
        if (user.auth_user_id) {
          const existing = await client.query<{ room_id: string }>(
            "SELECT room_id FROM room_memberships WHERE user_id = $1", [user.id],
          );
          replacedRoomIds = existing.rows.map((row) => row.room_id);
          if (user.guest_room_id && user.guest_room_id !== roomId) {
            const removed = await client.query<{ room_id: string }>(
              "DELETE FROM room_memberships WHERE user_id = $1 AND room_id = $2 RETURNING room_id",
              [user.id, user.guest_room_id],
            );
            for (const replacedRoomId of removed.rows.map((row) => row.room_id)) {
              await this.markEmptyRoom(client, replacedRoomId);
            }
          }
        } else {
          const removed = await client.query<{ room_id: string }>(
            "DELETE FROM room_memberships WHERE user_id = $1 AND room_id <> $2 RETURNING room_id",
            [user.id, roomId],
          );
          replacedRoomIds = removed.rows.map((row) => row.room_id);
          for (const replacedRoomId of replacedRoomIds) await this.markEmptyRoom(client, replacedRoomId);
        }
        await client.query("UPDATE guest_profiles SET guest_room_id = $2 WHERE id = $1", [user.id, roomId]);
        user.guest_room_id = roomId;
      }
      const member = await client.query<{ owner: boolean }>(
        `INSERT INTO room_memberships (user_id, room_id, owner) VALUES ($1, $2, false)
         ON CONFLICT (user_id, room_id) DO UPDATE SET owner = room_memberships.owner
         RETURNING owner`,
        [user.id, roomId],
      );
      await client.query("UPDATE rooms SET empty_since = NULL WHERE id = $1", [roomId]);
      return {
        userId: user.id,
        roomId,
        name: user.name,
        owner: member.rows[0]!.owner,
        deviceToken: issuedToken!,
        ...(replacedRoomIds.length ? { replacedRoomIds } : {}),
      };
    });
  }

  private async markEmptyRoom(client: PoolClient, roomId: string): Promise<void> {
    await client.query(
      `UPDATE rooms SET empty_since = COALESCE(empty_since, now())
       WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM room_memberships WHERE room_id = $1)`, [roomId],
    );
  }

  async leaveRoom(deviceToken: string, roomId: string, authUserId?: string): Promise<DeviceMembership | null> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, true, authUserId);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      if (!authUserId && roomId !== await this.guestRoomForDevice(client, user)) return null;
      const deleted = await client.query<{ room_id: string; owner: boolean }>(
        "DELETE FROM room_memberships WHERE user_id = $1 AND room_id = $2 RETURNING room_id, owner", [user.id, roomId],
      );
      const member = deleted.rows[0];
      if (!member) return null;
      if (user.guest_room_id === member.room_id) {
        await client.query("UPDATE guest_profiles SET guest_room_id = NULL WHERE id = $1", [user.id]);
      }
      await this.markEmptyRoom(client, member.room_id);
      return { userId: user.id, roomId: member.room_id, name: user.name, owner: member.owner };
    });
  }

  async hasMembers(roomId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM room_memberships WHERE room_id = $1 LIMIT 1", [roomId]);
    return Boolean(result.rowCount);
  }

  async listRooms(limit = MAX_CATALOG_PAGE_SIZE, offset = 0): Promise<{ rooms: StoredRoom[]; nextOffset: number | null }> {
    validateCatalogPage(limit, offset);
    const result = await this.pool.query<RoomRow>(
      "SELECT * FROM rooms ORDER BY created_at DESC, id LIMIT $1 OFFSET $2",
      [limit + 1, offset],
    );
    const hasMore = result.rows.length > limit;
    return {
      rooms: result.rows.slice(0, limit).map(room),
      nextOffset: hasMore && offset + limit <= MAX_CATALOG_OFFSET ? offset + limit : null,
    };
  }

  async getRoom(id: string): Promise<StoredRoom | null> {
    const result = await this.pool.query<RoomRow>("SELECT * FROM rooms WHERE id = $1", [id]);
    return result.rows[0] ? room(result.rows[0]) : null;
  }

  async createRoom(id: string, name: string): Promise<StoredRoom | null> {
    const result = await this.pool.query<RoomRow>(
      "INSERT INTO rooms (id, name, empty_since) VALUES ($1, $2, now()) ON CONFLICT (id) DO NOTHING RETURNING *",
      [id, name.trim()],
    );
    return result.rows[0] ? room(result.rows[0]) : null;
  }

  async updateRoom(id: string, name: string): Promise<StoredRoom | null> {
    const result = await this.pool.query<RoomRow>(
      "UPDATE rooms SET name = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [id, name.trim()],
    );
    return result.rows[0] ? room(result.rows[0]) : null;
  }

  async deleteRoom(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM rooms WHERE id = $1", [id]);
    return Boolean(result.rowCount);
  }

  async listProfiles(limit = MAX_CATALOG_PAGE_SIZE, offset = 0): Promise<{ profiles: GuestProfile[]; nextOffset: number | null }> {
    validateCatalogPage(limit, offset);
    const result = await this.pool.query<ProfileRow>(
      "SELECT * FROM guest_profiles ORDER BY created_at DESC, id LIMIT $1 OFFSET $2",
      [limit + 1, offset],
    );
    const hasMore = result.rows.length > limit;
    return {
      profiles: result.rows.slice(0, limit).map(profile),
      nextOffset: hasMore && offset + limit <= MAX_CATALOG_OFFSET ? offset + limit : null,
    };
  }

  async getProfile(id: string): Promise<GuestProfile | null> {
    const result = await this.pool.query<ProfileRow>("SELECT * FROM guest_profiles WHERE id = $1", [id]);
    return result.rows[0] ? profile(result.rows[0]) : null;
  }

  async createProfile(name: string): Promise<GuestProfile> {
    const result = await this.pool.query<ProfileRow>(
      "INSERT INTO guest_profiles (id, name) VALUES ($1, $2) RETURNING *",
      [randomUUID(), name.trim()],
    );
    return profile(result.rows[0]!);
  }

  async updateProfile(id: string, name: string): Promise<GuestProfile | null> {
    const result = await this.pool.query<ProfileRow>(
      "UPDATE guest_profiles SET name = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [id, name.trim()],
    );
    return result.rows[0] ? profile(result.rows[0]) : null;
  }

  async deleteProfile(id: string): Promise<{ deleted: boolean; roomId: string | null }> {
    return transaction(this.pool, async (client) => {
      const memberships = await client.query<{ room_id: string }>("SELECT room_id FROM room_memberships WHERE user_id = $1", [id]);
      const result = await client.query("DELETE FROM guest_profiles WHERE id = $1", [id]);
      const roomIds = memberships.rows.map((membership) => membership.room_id);
      for (const roomId of roomIds) await this.markEmptyRoom(client, roomId);
      return { deleted: Boolean(result.rowCount), roomId: roomIds[0] ?? null, roomIds };
    });
  }

  async cleanupEmptyRooms(days: number): Promise<string[]> {
    if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be a positive integer");
    const result = await this.pool.query<{ id: string }>(
      `DELETE FROM rooms
       WHERE empty_since IS NOT NULL
         AND empty_since < now() - make_interval(days => $1::integer)
         AND NOT EXISTS (SELECT 1 FROM room_memberships WHERE room_id = rooms.id)
       RETURNING id`,
      [days],
    );
    return result.rows.map((row) => row.id);
  }

  async cleanupUnusedProfiles(days: number): Promise<string[]> {
    if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be a positive integer");
    const result = await this.pool.query<{ id: string }>(
      `DELETE FROM guest_profiles AS profile
       WHERE profile.last_seen_at < now() - make_interval(days => $1::integer)
         AND NOT EXISTS (
           SELECT 1 FROM room_memberships WHERE room_memberships.user_id = profile.id
         )
       RETURNING id`,
      [days],
    );
    return result.rows.map((row) => row.id);
  }

  async cleanupExpiredRateLimits(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM api_rate_limits WHERE expires_at <= now()",
    );
    return result.rowCount ?? 0;
  }

  async cleanupExpiredWebSocketConnections(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM api_ws_connections WHERE expires_at <= now()",
    );
    return result.rowCount ?? 0;
  }

  async acquireWebSocketConnection(ip: string, maxConnections: number): Promise<string | null> {
    const ipHash = createHash("sha256").update(normalizeIP(ip)).digest("hex");
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 73492815))",
        [ipHash],
      );
      await client.query(
        "DELETE FROM api_ws_connections WHERE ip_hash = $1 AND expires_at <= now()",
        [ipHash],
      );
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM api_ws_connections WHERE ip_hash = $1",
        [ipHash],
      );
      if (Number(count.rows[0]?.count ?? 0) >= maxConnections) return null;

      const leaseId = randomUUID();
      await client.query(
        "INSERT INTO api_ws_connections (lease_id, ip_hash, expires_at) VALUES ($1, $2, now() + interval '2 minutes')",
        [leaseId, ipHash],
      );
      return leaseId;
    });
  }

  async renewWebSocketConnection(leaseId: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE api_ws_connections SET expires_at = now() + interval '2 minutes' WHERE lease_id = $1 AND expires_at > now()",
      [leaseId],
    );
    return Boolean(result.rowCount);
  }

  async releaseWebSocketConnection(leaseId: string): Promise<void> {
    await this.pool.query("DELETE FROM api_ws_connections WHERE lease_id = $1", [leaseId]);
  }
}
