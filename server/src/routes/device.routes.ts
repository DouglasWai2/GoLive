import type { FastifyInstance } from "fastify";
import { CatalogError, type CatalogService } from "../services/catalog.service.js";
import { issueRoomSession } from "../services/access.service.js";
import { RoomService } from "../services/room.service.js";
import { SignalingService } from "../services/signaling.service.js";
import { ROOM_ID_PATTERN } from "../utils/room-id.js";
import { DEVICE_TOKEN_LENGTH, DISPLAY_NAME_PATTERN } from "../utils/validation.js";
import type { NeonAuthVerifier } from "../services/neon-auth.service.js";

type DeviceRequest = { token: string; authUserId?: string };

export function registerDeviceRoutes(
  app: FastifyInstance,
  rooms: RoomService,
  catalog?: CatalogService,
  signaling?: SignalingService,
  verifyNeonAuth: NeonAuthVerifier = async () => null,
): void {
  const options = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  const bearer = (header?: string): string | null => {
    const match = /^Bearer (\S+)$/i.exec(header ?? "");
    return match?.[1] ?? null;
  };
  const credential = (headers: { authorization?: string; "x-device-token"?: string }): string | null => {
    const deviceToken = headers["x-device-token"];
    if (deviceToken !== undefined) {
      return deviceToken.length === DEVICE_TOKEN_LENGTH ? deviceToken : null;
    }
    const authorization = headers.authorization;
    if (authorization?.length !== 7 + DEVICE_TOKEN_LENGTH) return null;
    return bearer(authorization);
  };
  const requireCatalog = (reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (!catalog) {
      reply.code(503).send({ error: "Database unavailable" });
      return false;
    }
    return true;
  };
  const requireCredential = async (
    request: { headers: { authorization?: string; "x-device-token"?: string } },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ): Promise<DeviceRequest | null> => {
    const token = credential(request.headers);
    if (!token) {
      reply.code(401).send({ error: "Device credential required" });
      return null;
    }
    try {
      let authUserId: string | undefined;
      if (request.headers["x-device-token"] !== undefined && request.headers.authorization !== undefined) {
        const authToken = bearer(request.headers.authorization);
        if (!authToken) {
          reply.code(401).send({ error: "Invalid authorization token" });
          return null;
        }
        const identity = await verifyNeonAuth(authToken);
        if (!identity) {
          reply.code(401).send({ error: "Invalid or expired Neon Auth token" });
          return null;
        }
        authUserId = identity.id;
      }
      const linkedUserId = await catalog!.getDeviceAuthUserId(token);
      if (linkedUserId && authUserId && linkedUserId !== authUserId) {
        reply.code(403).send({ error: "This device profile is linked to a different Google account." });
        return null;
      }
      return { token, authUserId };
    } catch (error) {
      if (error instanceof CatalogError) {
        reply.code(error.status).send({ error: error.message });
        return null;
      }
      throw error;
    }
  };

  app.get("/device/rooms", options, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    try {
      return reply.header("Cache-Control", "no-store").send({ rooms: await catalog!.listDeviceRooms(device.token, device.authUserId) });
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.post("/device/rooms/:roomId/session", {
    ...options,
    schema: { params: { type: "object", required: ["roomId"], properties: { roomId: { type: "string", minLength: 8, maxLength: 64, pattern: ROOM_ID_PATTERN } } } },
  }, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    const { roomId } = request.params as { roomId: string };
    try {
      const member = await catalog!.getDeviceMembership(device.token, roomId, device.authUserId);
      if (!member) return reply.code(404).send({ error: "Room not found" });
      return reply.header("Cache-Control", "no-store").send({ ...issueRoomSession(app, rooms, member), deviceToken: device.token });
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.delete("/device/rooms/:roomId", {
    ...options,
    schema: { params: { type: "object", required: ["roomId"], properties: { roomId: { type: "string", minLength: 8, maxLength: 64, pattern: ROOM_ID_PATTERN } } } },
  }, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    const { roomId } = request.params as { roomId: string };
    try {
      const member = await catalog!.leaveRoom(device.token, roomId, device.authUserId);
      if (member) {
        rooms.disconnectUser(member.userId, roomId);
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.get("/device/profile", options, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    try {
      const { id: _id, ...profile } = await catalog!.getDeviceProfile(device.token, device.authUserId);
      return reply.header("Cache-Control", "no-store").send(profile);
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.patch("/device/profile", {
    ...options,
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: {
            type: "string",
            minLength: 1,
            maxLength: 32,
            pattern: DISPLAY_NAME_PATTERN,
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    const { name } = request.body as { name: string };
    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    try {
      const updated = await catalog!.updateDeviceProfile(device.token, name, device.authUserId);
      signaling?.updateUserName(updated.userId, updated.profile.name);
      const { id: _id, ...profile } = updated.profile;
      return reply.header("Cache-Control", "no-store").send(profile);
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  // Compatibility endpoint: older clients can still restore one authorized room.
  app.get("/device/room", options, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    try {
      const member = await catalog!.getMembership(device.token, device.authUserId);
      if (!member) return reply.code(404).send({ error: "No saved room" });
      return reply.header("Cache-Control", "no-store").send({ ...issueRoomSession(app, rooms, member), deviceToken: device.token });
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  // Leaving a room now ends the client session but keeps the access grant.
  app.delete("/device/room", options, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = await requireCredential(request, reply);
    if (!device) return;
    try {
      const profile = await catalog!.getDeviceProfile(device.token, device.authUserId);
      rooms.disconnectUser(profile.id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });
}
