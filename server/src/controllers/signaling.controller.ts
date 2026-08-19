import type { WebSocket } from "ws";
import type { SignalingService } from "../services/signaling.service.js";

export function createSignalingController(signalingService: SignalingService) {
  return {
    handleConnection(socket: WebSocket, ip: string): void {
      signalingService.handleConnection(socket, ip);
    },
  };
}