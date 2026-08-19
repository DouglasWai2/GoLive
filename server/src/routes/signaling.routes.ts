import type { FastifyInstance } from "fastify";
import { createSignalingController } from "../controllers/signaling.controller.js";
import { SignalingService } from "../services/signaling.service.js";

export function registerSignalingRoutes(
  app: FastifyInstance,
  signalingService: SignalingService,
): void {
  const controller = createSignalingController(signalingService);

  app.get("/ws", { websocket: true }, (socket, request) => {
    controller.handleConnection(socket, request.ip);
  });
}