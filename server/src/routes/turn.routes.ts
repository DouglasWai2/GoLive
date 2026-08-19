import type { FastifyInstance } from "fastify";
import { createTurnController } from "../controllers/turn.controller.js";
import { TurnService } from "../services/turn.service.js";

export function registerTurnRoutes(app: FastifyInstance, turnService: TurnService): void {
  const controller = createTurnController(turnService);

  app.get("/turn-credentials", controller.getTurnCredentials);
  app.get("/turn-usage", controller.getTurnUsage);
}