import type { WebSocket } from "ws";
import type { SignalingService } from "../services/signaling.service.js";

export function createSignalingController(signalingService: SignalingService) {
  return {
    handleConnection(socket: WebSocket): void {
      signalingService.handleConnection(socket);
    },
  };
}