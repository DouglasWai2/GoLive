import type { FastifyInstance } from "fastify";
import type { FastifyRequest, FastifyReply } from "fastify";
import { RoomService } from "../services/room.service.js";
import { CatalogError, type CatalogService } from "../services/catalog.service.js";
import { issueRoomSession } from "../services/access.service.js";

type CreateRoomBody = {
  roomId: string;
  name: string;
  deviceToken?: string;
};

export function createRoomController(roomService: RoomService, app: FastifyInstance, catalog?: CatalogService) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const { roomId, name, deviceToken } = request.body as CreateRoomBody;

    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    if (catalog) {
      try {
        const enrolled = await catalog.createOwnedRoom(roomId, name, deviceToken);
        return reply.header("Cache-Control", "no-store").send({
          ...issueRoomSession(app, roomService, enrolled),
          deviceToken: enrolled.deviceToken,
        });
      } catch (error) {
        if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
        throw error;
      }
    }
    const session = roomService.createRoomSession(roomId, name);
    if (!session) {
      return reply.code(403).send({
        error: "This room requires an invite to join.",
      });
    }

    const token = app.jwt.sign(
      { ...session, host: true },
      {
        expiresIn: 8 * 60 * 60,
      },
    );

    return reply.send({ session, token });
  };
}
