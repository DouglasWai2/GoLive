import type { WebSocket } from "ws";

export const MAX_SIGNALING_MESSAGE_BYTES = 64 * 1024;

export function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
