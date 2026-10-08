import type { FastifyInstance } from "fastify";
import { CatalogError, type CatalogService } from "../services/catalog.service.js";
import { issueRoomSession } from "../services/access.service.js";
import { RoomService } from "../services/room.service.js";

export function registerDeviceRoutes(app: FastifyInstance, rooms: RoomService, catalog?: CatalogService): void {
  const options = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  const credential = (header?: string): string | null => {
    const match = /^Bearer (\S+)$/i.exec(header ?? "");
    return match?.[1] ?? null;
  };

  app.get("/device/room", options, async (request, reply) => {
    if (!catalog) return reply.code(503).send({ error: "Database unavailable" });
    const token = credential(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "Device credential required" });
    try {
      const member = await catalog.getMembership(token);
      if (!member) return reply.code(404).send({ error: "No saved room" });
      return reply.header("Cache-Control", "no-store").send({ ...issueRoomSession(app, rooms, member), deviceToken: token });
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.delete("/device/room", options, async (request, reply) => {
    if (!catalog) return reply.code(503).send({ error: "Database unavailable" });
    const token = credential(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "Device credential required" });
    try {
      const member = await catalog.leaveRoom(token);
      if (member) {
        rooms.disconnectUser(member.userId);
        if (!await catalog.hasMembers(member.roomId)) rooms.invalidateRoom(member.roomId);
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });
}
