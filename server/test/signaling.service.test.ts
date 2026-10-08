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
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    this.emit("sent", message);
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

function waitForMessage(socket: FakeWebSocket, type: string, timestamp?: number): Promise<Record<string, unknown>> {
  const matches = (message: Record<string, unknown>) =>
    message.type === type && (timestamp === undefined || message.timestamp === timestamp);
  const existing = socket.sent.find(matches);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const onSent = (message: Record<string, unknown>) => {
      if (!matches(message)) return;
      socket.off("sent", onSent);
      resolve(message);
    };
    socket.on("sent", onSent);
  });
}

test("answers keepalive pings from every room member after the host leaves", { timeout: 5000 }, async () => {
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
    await waitForMessage(hostSocket, "authenticated");
    hostSocket.receive({ type: "join", room: "keepalive-room", name: "Host" });
    await waitForMessage(hostSocket, "room-state");
    guestSocket.receive({ type: "auth", token: "guest-token" });
    await waitForMessage(guestSocket, "authenticated");
    guestSocket.receive({ type: "join", room: "keepalive-room", name: "Guest" });

    const guestRoomState = await waitForMessage(guestSocket, "room-state");
    assert.deepEqual(guestRoomState, {
      type: "room-state",
      peers: [{ id: host.sessionId, name: "Host", sharing: false }],
    });

    guestSocket.receive({ type: "ping", timestamp: 123 });
    assert.deepEqual(await waitForMessage(guestSocket, "pong", 123), { type: "pong", timestamp: 123 });

    hostSocket.receive({ type: "ping", timestamp: 456 });
    assert.deepEqual(await waitForMessage(hostSocket, "pong", 456), { type: "pong", timestamp: 456 });

    hostSocket.close();
    guestSocket.receive({ type: "ping", timestamp: 789 });
    assert.deepEqual(await waitForMessage(guestSocket, "pong", 789), { type: "pong", timestamp: 789 });
  } finally {
    hostSocket.close();
    guestSocket.close();
  }
});
