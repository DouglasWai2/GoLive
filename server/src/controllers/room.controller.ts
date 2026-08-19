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

    const session = roomService.createSession(roomId, name);

    const token = app.jwt.sign(
      { sessionId: session.sessionId, roomId, name },
      {
        expiresIn: 8 * 60 * 60,
      },
    );

    return reply.send({ session, token });
  };
}