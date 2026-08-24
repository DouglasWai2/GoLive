import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "ws";
import { RoomService } from "../src/services/room.service.js";
import type { Client } from "../src/types/room.js";

function client(
  id: string,
  connectedAt = "2026-08-24T00:00:00.000Z",
): Client {
  return {
    id,
    sessionId: id,
    name: id,
    sharing: false,
    socket: {} as WebSocket,
    connectedAt,
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

test("returns a sanitized active-room snapshot", () => {
  const rooms = new RoomService();
  const room = rooms.getRoom("room-id");
  const first = client("first", "2026-08-24T10:00:00.000Z");
  const second = client("second", "2026-08-24T09:00:00.000Z");
  second.sharing = true;
  room.set(first.id, first);
  room.set(second.id, second);
  rooms.getRoom("empty-room");

  const snapshot = rooms.getSnapshot();

  assert.deepEqual(
    {
      activeRooms: snapshot.activeRooms,
      activeUsers: snapshot.activeUsers,
      activeSharers: snapshot.activeSharers,
    },
    { activeRooms: 1, activeUsers: 2, activeSharers: 1 },
  );
  assert.equal(snapshot.rooms[0]?.startedAt, second.connectedAt);
  assert.deepEqual(snapshot.rooms[0]?.participants[0], {
    id: "first",
    name: "first",
    sharing: false,
    connectedAt: first.connectedAt,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /sessionId|socket/);
});
