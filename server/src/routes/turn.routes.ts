import type { FastifyInstance } from "fastify";
import { createTurnController } from "../controllers/turn.controller.js";
import { TurnService } from "../services/turn.service.js";

export function registerTurnRoutes(app: FastifyInstance): void {
  const controller = createTurnController(new TurnService());

  app.get(
    "/turn-credentials",
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
        } catch {
          return reply.code(401).send({ error: "Unauthorized" });
        }
      },
    },
    controller.getTurnCredentials,
  );
}