import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

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

export type Enrollment = DeviceMembership & { deviceToken: string; previousRoomId: string | null };

export class CatalogError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const DEVICE_TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

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

  private async resolveDevice(client: PoolClient, deviceToken: string, lock = false): Promise<{ id: string; name: string } | null> {
    const match = DEVICE_TOKEN_PATTERN.exec(deviceToken);
    if (!match) return null;
    const result = await client.query<{ id: string; name: string; credential_hash: string }>(
      `SELECT id, name, credential_hash FROM guest_profiles WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
      [match[1]],
    );
    const user = result.rows[0];
    return user?.credential_hash === tokenHash(match[2]!) ? user : null;
  }

  async getMembership(deviceToken: string): Promise<DeviceMembership | null> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const result = await client.query<{ room_id: string; owner: boolean }>(
        "SELECT room_id, owner FROM room_memberships WHERE user_id = $1", [user.id],
      );
      const member = result.rows[0];
      return member ? { userId: user.id, roomId: member.room_id, name: user.name, owner: member.owner } : null;
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

  async createOwnedRoom(roomId: string, name: string, deviceToken?: string): Promise<Enrollment> {
    return transaction(this.pool, async (client) => {
      let user = deviceToken ? await this.resolveDevice(client, deviceToken, true) : null;
      if (deviceToken && !user) throw new CatalogError(401, "Invalid device credential");
      if (user) {
        const existing = await client.query("SELECT 1 FROM room_memberships WHERE user_id = $1", [user.id]);
        if (existing.rowCount) throw new CatalogError(409, "Leave your current room before creating another");
        await client.query("UPDATE guest_profiles SET name = $2, updated_at = now() WHERE id = $1", [user.id, name.trim()]);
        user.name = name.trim();
      }
      const created = await client.query(
        "INSERT INTO rooms (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
        [roomId, `Room ${roomId}`],
      );
      if (!created.rowCount) throw new CatalogError(403, "This room requires an invite to join.");
      let issuedToken = deviceToken;
      if (!user) {
        const id = randomUUID();
        const secret = randomBytes(32).toString("base64url");
        issuedToken = `${id}.${secret}`;
        await client.query("INSERT INTO guest_profiles (id, name, credential_hash) VALUES ($1, $2, $3)",
          [id, name.trim(), tokenHash(secret)]);
        user = { id, name: name.trim() };
      }
      await client.query("INSERT INTO room_memberships (user_id, room_id, owner) VALUES ($1, $2, true)", [user.id, roomId]);
      return { userId: user.id, roomId, name: user.name, owner: true, deviceToken: issuedToken!, previousRoomId: null };
    });
  }

  async joinByInvite(roomId: string, generation: string, name: string, deviceToken?: string): Promise<Enrollment> {
    return transaction(this.pool, async (client) => {
      let user = deviceToken ? await this.resolveDevice(client, deviceToken, true) : null;
      if (deviceToken && !user) throw new CatalogError(401, "Invalid device credential");
      // Lock the room so deletion and enrollment cannot race.
      const room = await client.query("SELECT 1 FROM rooms WHERE id = $1 AND generation = $2 FOR UPDATE", [roomId, generation]);
      if (!room.rowCount) throw new CatalogError(403, "Invite does not match this room.");
      let issuedToken = deviceToken;
      if (!user) {
        const id = randomUUID();
        const secret = randomBytes(32).toString("base64url");
        issuedToken = `${id}.${secret}`;
        await client.query("INSERT INTO guest_profiles (id, name, credential_hash) VALUES ($1, $2, $3)",
          [id, name.trim(), tokenHash(secret)]);
        user = { id, name: name.trim() };
      } else {
        await client.query("UPDATE guest_profiles SET name = $2, updated_at = now() WHERE id = $1", [user.id, name.trim()]);
      }
      const previous = await client.query<{ room_id: string; owner: boolean }>(
        "SELECT room_id, owner FROM room_memberships WHERE user_id = $1", [user.id],
      );
      const previousRoomId = previous.rows[0]?.room_id ?? null;
      const owner = previousRoomId === roomId && previous.rows[0]?.owner === true;
      await client.query(
        `INSERT INTO room_memberships (user_id, room_id, owner) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET room_id = EXCLUDED.room_id, owner = EXCLUDED.owner`,
        [user.id, roomId, owner],
      );
      if (previousRoomId && previousRoomId !== roomId) await this.removeEmptyRoom(client, previousRoomId);
      return { userId: user.id, roomId, name: name.trim(), owner, deviceToken: issuedToken!, previousRoomId };
    });
  }

  private async removeEmptyRoom(client: PoolClient, roomId: string): Promise<void> {
    await client.query(
      "DELETE FROM rooms WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM room_memberships WHERE room_id = $1)", [roomId],
    );
  }

  async leaveRoom(deviceToken: string): Promise<DeviceMembership | null> {
    return transaction(this.pool, async (client) => {
      const user = await this.resolveDevice(client, deviceToken, true);
      if (!user) throw new CatalogError(401, "Invalid device credential");
      const deleted = await client.query<{ room_id: string; owner: boolean }>(
        "DELETE FROM room_memberships WHERE user_id = $1 RETURNING room_id, owner", [user.id],
      );
      const member = deleted.rows[0];
      if (!member) return null;
      await this.removeEmptyRoom(client, member.room_id);
      return { userId: user.id, roomId: member.room_id, name: user.name, owner: member.owner };
    });
  }

  async hasMembers(roomId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM room_memberships WHERE room_id = $1 LIMIT 1", [roomId]);
    return Boolean(result.rowCount);
  }

  async listRooms(): Promise<StoredRoom[]> {
    const result = await this.pool.query<RoomRow>("SELECT * FROM rooms ORDER BY created_at DESC, id");
    return result.rows.map(room);
  }

  async getRoom(id: string): Promise<StoredRoom | null> {
    const result = await this.pool.query<RoomRow>("SELECT * FROM rooms WHERE id = $1", [id]);
    return result.rows[0] ? room(result.rows[0]) : null;
  }

  async createRoom(id: string, name: string): Promise<StoredRoom | null> {
    const result = await this.pool.query<RoomRow>(
      "INSERT INTO rooms (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING *",
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

  async listProfiles(): Promise<GuestProfile[]> {
    const result = await this.pool.query<ProfileRow>("SELECT * FROM guest_profiles ORDER BY created_at DESC, id");
    return result.rows.map(profile);
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
      const membership = await client.query<{ room_id: string }>("SELECT room_id FROM room_memberships WHERE user_id = $1", [id]);
      const result = await client.query("DELETE FROM guest_profiles WHERE id = $1", [id]);
      const roomId = membership.rows[0]?.room_id ?? null;
      if (roomId) await this.removeEmptyRoom(client, roomId);
      return { deleted: Boolean(result.rowCount), roomId };
    });
  }
}
