import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.routes.js";
import { registerSignalingRoutes } from "./signaling.routes.js";
import { registerTurnRoutes } from "./turn.routes.js";
import { RoomService } from "../services/room.service.js";
import { SignalingService } from "../services/signaling.service.js";
import { TurnService } from "../services/turn.service.js";

export function registerRoutes(app: FastifyInstance): void {
  const roomService = new RoomService();
  const signalingService = new SignalingService(roomService);
  const turnService = new TurnService();

  registerHealthRoutes(app);
  registerSignalingRoutes(app, signalingService);
  registerTurnRoutes(app, turnService);
}