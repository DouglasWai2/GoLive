import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.routes.js";
import { registerSignalingRoutes } from "./signaling.routes.js";
import { registerTurnRoutes } from "./turn.routes.js";
import { registerRoomRoutes } from "./room.routes.js";
import { registerInviteRoutes } from "./invite.routes.js";
import { RoomService } from "../services/room.service.js";
import { SignalingService } from "../services/signaling.service.js";
import { TurnService } from "../services/turn.service.js";
import type { RoomToken } from "../types/room.js";

export function registerRoutes(app: FastifyInstance): void {
  const roomService = new RoomService();

  const verifyRoomToken = (token: string): RoomToken | null => {
    try {
      return app.jwt.verify<RoomToken>(token);
    } catch {
      return null;
    }
  };

  const signalingService = new SignalingService(roomService, verifyRoomToken);

  registerHealthRoutes(app);
  registerSignalingRoutes(app, signalingService);
  registerTurnRoutes(app);
  registerRoomRoutes(app, roomService);
  registerInviteRoutes(app, roomService);
}