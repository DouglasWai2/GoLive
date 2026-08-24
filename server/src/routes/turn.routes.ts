import type { FastifyInstance } from "fastify";
import { createTurnController } from "../controllers/turn.controller.js";
import { TurnService } from "../services/turn.service.js";
import { RoomService } from "../services/room.service.js";
import { isRoomToken } from "../types/room.js";

export function registerTurnRoutes(
  app: FastifyInstance,
  roomService: RoomService,
): void {
  const controller = createTurnController(new TurnService());

  app.get(
    "/session",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      preHandler: async (request, reply) => {
        try {
          await request.jwtVerify();

          if (!isRoomToken(request.user)) {
            return reply.code(401).send({ error: "Unauthorized" });
          }

          const session = roomService.getClient(
            request.user.roomId,
            request.user.sessionId,
          );

          if (!session) {
            return reply.code(403).send({ error: "Join the room first" });
          }
        } catch {
          return reply.code(401).send({ error: "Unauthorized" });
        }
      },
    },
    controller.getTurnCredentials,
  );
}
