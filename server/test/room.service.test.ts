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

test("keeps a room active while another participant remains", () => {
  const rooms = new RoomService();
  const creator = rooms.createRoomSession("room-id", "creator");
  assert.ok(creator);
  const room = rooms.getRoom("room-id");

  room.set(creator.sessionId, client(creator.sessionId));
  room.set("guest", client("guest"));

  rooms.removeClient("room-id", creator.sessionId);
  assert.equal(rooms.isCurrentRoomInstance("room-id", creator.roomInstanceId), true);
  assert.equal(rooms.getClient("room-id", "guest")?.id, "guest");
  assert.equal(rooms.createRoomSession("room-id", "new creator"), undefined);
});

test("invalidates the room instance when its last client leaves", () => {
  const rooms = new RoomService();
  const creator = rooms.createRoomSession("room-id", "creator");
  assert.ok(creator);
  rooms.getRoom("room-id").set(creator.sessionId, client(creator.sessionId));

  assert.equal(
    rooms.isCurrentRoomInstance("room-id", creator.roomInstanceId),
    true,
  );

  rooms.removeClient("room-id", creator.sessionId);

  assert.equal(
    rooms.isCurrentRoomInstance("room-id", creator.roomInstanceId),
    false,
  );
  assert.ok(rooms.createRoomSession("room-id", "new creator"));
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
