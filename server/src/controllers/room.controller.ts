import type { FastifyInstance } from "fastify";
import type { FastifyRequest, FastifyReply } from "fastify";
import { RoomService } from "../services/room.service.js";
import { CatalogError, type CatalogService } from "../services/catalog.service.js";
import { issueRoomSession } from "../services/access.service.js";
import type { NeonAuthVerifier } from "../services/neon-auth.service.js";

type CreateRoomBody = {
  roomId: string;
  name?: string;
  deviceToken?: string;
};

export function createRoomController(
  roomService: RoomService,
  app: FastifyInstance,
  catalog?: CatalogService,
  verifyNeonAuth: NeonAuthVerifier = async () => null,
) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const { roomId, name, deviceToken } = request.body as CreateRoomBody;

    if (name !== undefined && !name.trim()) return reply.code(400).send({ error: "Name is required" });

    const authorization = request.headers.authorization;
    let authUserId: string | undefined;
    if (authorization !== undefined) {
      const match = /^Bearer (\S+)$/i.exec(authorization);
      if (!match) return reply.code(401).send({ error: "Invalid authorization token" });
      const identity = await verifyNeonAuth(match[1]!);
      if (!identity) return reply.code(401).send({ error: "Invalid or expired Neon Auth token" });
      authUserId = identity.id;
      if (!catalog) return reply.code(503).send({ error: "Database unavailable" });
    }

    if (catalog) {
      try {
        const enrolled = await catalog.createOwnedRoom(roomId, name, deviceToken, authUserId);
        for (const previousRoomId of enrolled.replacedRoomIds ?? []) {
          roomService.disconnectUser(enrolled.userId, previousRoomId);
          if (!await catalog.hasMembers(previousRoomId)) roomService.invalidateRoom(previousRoomId);
        }
        return reply.header("Cache-Control", "no-store").send({
          ...issueRoomSession(app, roomService, enrolled),
          deviceToken: enrolled.deviceToken,
        });
      } catch (error) {
        if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
        throw error;
      }
    }
    if (!name?.trim()) return reply.code(400).send({ error: "Name is required" });
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
