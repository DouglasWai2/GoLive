import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "ws";
import { RoomService } from "../src/services/room.service.js";
import type { Client } from "../src/types/room.js";

function client(id: string): Client {
  return {
    id,
    sessionId: id,
    name: id,
    sharing: false,
    socket: {} as WebSocket,
  };
}

test("elects a guest temporarily and restores the creator", () => {
  const rooms = new RoomService();
  const room = rooms.getRoom("room-id");

  rooms.claimHost("room-id", "creator");
  room.set("creator", client("creator"));
  room.set("guest-a", client("guest-a"));
  room.set("guest-b", client("guest-b"));

  assert.equal(rooms.refreshHeartbeatOwner("room-id"), "creator");

  rooms.removeClient("room-id", "creator");
  assert.equal(rooms.getHeartbeatOwner("room-id"), "guest-a");

  assert.equal(rooms.rotateHeartbeatOwner("room-id"), "guest-b");

  room.set("creator", client("creator"));
  assert.equal(rooms.reclaimHostHeartbeat("room-id", "creator"), "creator");
});
