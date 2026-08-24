import type { FastifyInstance } from "fastify";
import type { FastifyRequest, FastifyReply } from "fastify";
import { RoomService } from "../services/room.service.js";

type CreateRoomBody = {
  roomId: string;
  name: string;
};

export function createRoomController(roomService: RoomService, app: FastifyInstance) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const { roomId, name } = request.body as CreateRoomBody;

    if (roomService.hasHost(roomId)) {
      return reply.code(403).send({
        error: "This room requires an invite to join.",
      });
    }

    const session = roomService.createSession(roomId, name);
    roomService.claimHost(roomId, session.sessionId);

    const token = app.jwt.sign(
      { kind: "room", sessionId: session.sessionId, roomId, name, host: true },
      {
        expiresIn: 8 * 60 * 60,
      },
    );

    return reply.send({ session, token });
  };
}
