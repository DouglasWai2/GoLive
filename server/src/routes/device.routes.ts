import type { FastifyInstance } from "fastify";
import { CatalogError, type CatalogService } from "../services/catalog.service.js";
import { issueRoomSession } from "../services/access.service.js";
import { RoomService } from "../services/room.service.js";
import { SignalingService } from "../services/signaling.service.js";
import { ROOM_ID_PATTERN } from "../utils/room-id.js";

type DeviceRequest = { token: string };

export function registerDeviceRoutes(
  app: FastifyInstance,
  rooms: RoomService,
  catalog?: CatalogService,
  signaling?: SignalingService,
): void {
  const options = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  const credential = (header?: string): string | null => {
    const match = /^Bearer (\S+)$/i.exec(header ?? "");
    return match?.[1] ?? null;
  };
  const requireCatalog = (reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (!catalog) {
      reply.code(503).send({ error: "Database unavailable" });
      return false;
    }
    return true;
  };
  const requireCredential = (request: { headers: { authorization?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): DeviceRequest | null => {
    const token = credential(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: "Device credential required" });
      return null;
    }
    return { token };
  };

  app.get("/device/rooms", options, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = requireCredential(request, reply);
    if (!device) return;
    try {
      return reply.header("Cache-Control", "no-store").send({ rooms: await catalog!.listDeviceRooms(device.token) });
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
    const device = requireCredential(request, reply);
    if (!device) return;
    const { roomId } = request.params as { roomId: string };
    try {
      const member = await catalog!.getDeviceMembership(device.token, roomId);
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
    const device = requireCredential(request, reply);
    if (!device) return;
    const { roomId } = request.params as { roomId: string };
    try {
      const member = await catalog!.leaveRoom(device.token, roomId);
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
    const device = requireCredential(request, reply);
    if (!device) return;
    try {
      const { id: _id, ...profile } = await catalog!.getDeviceProfile(device.token);
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
        properties: { name: { type: "string", minLength: 1, maxLength: 32 } },
      },
    },
  }, async (request, reply) => {
    if (!requireCatalog(reply)) return;
    const device = requireCredential(request, reply);
    if (!device) return;
    const { name } = request.body as { name: string };
    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    try {
      const updated = await catalog!.updateDeviceProfile(device.token, name);
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
    const device = requireCredential(request, reply);
    if (!device) return;
    try {
      const member = await catalog!.getMembership(device.token);
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
    const device = requireCredential(request, reply);
    if (!device) return;
    try {
      await catalog!.getDeviceProfile(device.token);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });
}
