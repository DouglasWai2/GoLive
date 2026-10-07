import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";
import { RoomService } from "../src/services/room.service.js";
import { SignalingService } from "../src/services/signaling.service.js";

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000): void {
    if (this.readyState !== this.OPEN) return;
    this.readyState = 3;
    this.emit("close", code, Buffer.alloc(0));
  }

  receive(message: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(message)), false);
  }
}

test("answers keepalive pings from every room member after the host leaves", () => {
  const rooms = new RoomService();
  const host = rooms.createRoomSession("keepalive-room", "Host");
  assert.ok(host);
  const guest = rooms.createSession("keepalive-room", "Guest", host.roomInstanceId);
  const service = new SignalingService(rooms, (token) => {
    if (token === "host-token") return { ...host, host: true };
    if (token === "guest-token") return { ...guest, host: false };
    return null;
  });
  const hostSocket = new FakeWebSocket();
  const guestSocket = new FakeWebSocket();

  service.handleConnection(hostSocket as unknown as WebSocket, "127.0.0.31");
  service.handleConnection(guestSocket as unknown as WebSocket, "127.0.0.32");

  try {
    hostSocket.receive({ type: "auth", token: "host-token" });
    hostSocket.receive({ type: "join", room: "keepalive-room", name: "Host" });
    guestSocket.receive({ type: "auth", token: "guest-token" });
    guestSocket.receive({ type: "join", room: "keepalive-room", name: "Guest" });

    const guestRoomState = guestSocket.sent.find((message) => message.type === "room-state");
    assert.deepEqual(guestRoomState, {
      type: "room-state",
      peers: [{ id: host.sessionId, name: "Host", sharing: false }],
    });

    guestSocket.receive({ type: "ping", timestamp: 123 });
    assert.ok(guestSocket.sent.some((message) => (
      message.type === "pong" && message.timestamp === 123
    )));

    hostSocket.receive({ type: "ping", timestamp: 456 });
    assert.ok(hostSocket.sent.some((message) => (
      message.type === "pong" && message.timestamp === 456
    )));

    hostSocket.close();
    guestSocket.receive({ type: "ping", timestamp: 789 });
    assert.ok(guestSocket.sent.some((message) => (
      message.type === "pong" && message.timestamp === 789
    )));
  } finally {
    hostSocket.close();
    guestSocket.close();
  }
});
