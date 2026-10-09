import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Socket } from "node:net";
import type { WebSocket } from "ws";
import { Pool } from "pg";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { CatalogService } from "../src/services/catalog.service.js";

const id = () => `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

async function nextMessage(socket: WebSocket): Promise<Record<string, any>> {
  const [data] = await once(socket, "message");
  return JSON.parse(data.toString()) as Record<string, any>;
}

async function connectAndJoin(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  roomId: string,
  name: string,
): Promise<{ socket: WebSocket; state: Record<string, any> }> {
  const socket = await app.injectWS("/ws", { socket: { remoteAddress: "127.0.0.1" } as Socket });
  const authenticated = nextMessage(socket);
  socket.send(JSON.stringify({ type: "auth", token }));
  assert.equal((await authenticated).type, "authenticated");
  const state = nextMessage(socket);
  socket.send(JSON.stringify({ type: "join", room: roomId, name }));
  return { socket, state: await state };
}

test("device profiles own multiple rooms, control room access, and retain a shared display name", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const original = {
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
  const firstId = id();
  const secondId = id();
  const invitedId = id();
  const unrelatedId = id();
  const staleEmptyId = id();
  const recentEmptyId = id();
  const testRoomIds = [firstId, secondId, invitedId, unrelatedId, staleEmptyId, recentEmptyId];
  const testUserIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let hostSocket: WebSocket | undefined;
  let guestSocket: WebSocket | undefined;

  try {
    app = await buildApp();
    const admin = { authorization: `Bearer ${app.jwt.sign({ kind: "admin" }, { expiresIn: 3600 })}` };

    const firstRoomResponse = await app.inject({ method: "POST", url: "/room", payload: { roomId: firstId, name: "Primary profile" } });
    assert.equal(firstRoomResponse.statusCode, 200, firstRoomResponse.body);
    const primary = firstRoomResponse.json<{ token: string; deviceToken: string; session: { name: string; userId: string } }>();
    testUserIds.push(primary.session.userId);
    assert.equal(primary.session.name, "Primary profile");

    const secondRoomResponse = await app.inject({
      method: "POST",
      url: "/room",
      payload: { roomId: secondId, name: "Per-room alias", deviceToken: primary.deviceToken },
    });
    assert.equal(secondRoomResponse.statusCode, 200, secondRoomResponse.body);
    assert.equal(secondRoomResponse.json().session.name, "Primary profile");

    const externalRoomResponse = await app.inject({ method: "POST", url: "/room", payload: { roomId: invitedId, name: "External owner" } });
    const external = externalRoomResponse.json<{ token: string; deviceToken: string; session: { userId: string } }>();
    testUserIds.push(external.session.userId);
    const inviteResponse = await app.inject({ method: "POST", url: "/invite", headers: { authorization: `Bearer ${external.token}` }, payload: { roomId: invitedId } });
    const inviteToken = inviteResponse.json<{ inviteToken: string }>().inviteToken;
    const joinedByInvite = await app.inject({
      method: "POST",
      url: "/invite/verify",
      payload: { roomId: invitedId, inviteToken, deviceToken: primary.deviceToken },
    });
    assert.equal(joinedByInvite.statusCode, 200, joinedByInvite.body);
    assert.equal(joinedByInvite.json().session.name, "Primary profile");
    assert.equal(app.jwt.verify<Record<string, unknown>>(joinedByInvite.json().token).host, false);

    const roomsResponse = await app.inject({ method: "GET", url: "/device/rooms", headers: { authorization: `Bearer ${primary.deviceToken}` } });
    assert.equal(roomsResponse.statusCode, 200, roomsResponse.body);
    const listedRoomIds = roomsResponse.json<{ rooms: Array<{ id: string; owner: boolean }> }>().rooms.map((room) => room.id);
    assert.deepEqual(new Set(listedRoomIds), new Set([firstId, secondId, invitedId]));
    assert.equal(roomsResponse.json<{ rooms: Array<{ id: string; owner: boolean }> }>().rooms.find((room) => room.id === invitedId)?.owner, false);
    assert.equal((await app.inject({ method: "GET", url: "/device/rooms" })).statusCode, 401);

    const unrelatedResponse = await app.inject({ method: "POST", url: "/room", payload: { roomId: unrelatedId, name: "Unrelated" } });
    assert.equal(unrelatedResponse.statusCode, 200);
    const unrelated = unrelatedResponse.json<{ deviceToken: string; session: { userId: string } }>();
    testUserIds.push(unrelated.session.userId);
    const forbiddenSession = await app.inject({
      method: "POST",
      url: `/device/rooms/${unrelatedId}/session`,
      headers: { authorization: `Bearer ${primary.deviceToken}` },
    });
    assert.equal(forbiddenSession.statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/device/rooms", headers: { authorization: `Bearer ${primary.deviceToken}` } })).json().rooms.some((room: { id: string }) => room.id === unrelatedId), false);
    assert.equal((await app.inject({ method: "POST", url: `/device/rooms/${unrelatedId}/session`, headers: { authorization: `Bearer ${unrelated.deviceToken}` } })).statusCode, 200);

    const profileResponse = await app.inject({ method: "GET", url: "/device/profile", headers: { authorization: `Bearer ${primary.deviceToken}` } });
    assert.equal(profileResponse.statusCode, 200);
    assert.equal(profileResponse.json().name, "Primary profile");
    assert.equal(profileResponse.json().id, undefined);

    const roomSessionResponse = await app.inject({ method: "POST", url: `/device/rooms/${firstId}/session`, headers: { authorization: `Bearer ${primary.deviceToken}` } });
    assert.equal(roomSessionResponse.statusCode, 200, roomSessionResponse.body);
    const primarySession = roomSessionResponse.json<{ token: string; session: { name: string } }>();

    const hostConnection = await connectAndJoin(app, primarySession.token, firstId, primarySession.session.name);
    assert.equal(hostConnection.state.type, "room-state");
    hostSocket = hostConnection.socket;

    const inviteForGuest = await app.inject({ method: "POST", url: "/invite", headers: { authorization: `Bearer ${primary.token}` }, payload: { roomId: firstId } });
    const firstInviteToken = inviteForGuest.json<{ inviteToken: string }>().inviteToken;
    const guestJoined = await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: firstId, name: "Guest profile", inviteToken: firstInviteToken } });
    assert.equal(guestJoined.statusCode, 200, guestJoined.body);
    const guest = guestJoined.json<{ token: string; deviceToken: string; session: { name: string; userId: string } }>();
    testUserIds.push(guest.session.userId);
    const hostSawGuest = nextMessage(hostSocket);
    const connectedGuest = await connectAndJoin(app, guest.token, firstId, guest.session.name);
    assert.equal(connectedGuest.state.type, "room-state");
    guestSocket = connectedGuest.socket;
    const guestJoinedMessage = await hostSawGuest;
    assert.equal(guestJoinedMessage.type, "peer-joined");

    const hostSawNameChange = nextMessage(hostSocket);
    const renamed = await app.inject({
      method: "PATCH",
      url: "/device/profile",
      headers: { authorization: `Bearer ${guest.deviceToken}` },
      payload: { name: "Guest updated" },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(renamed.json().name, "Guest updated");
    const peerUpdated = await hostSawNameChange;
    assert.equal(peerUpdated.type, "peer-updated");
    assert.equal(peerUpdated.peer.name, "Guest updated");

    const hostSawGuestReconnect = nextMessage(hostSocket);
    const guestReconnected = await connectAndJoin(app, guest.token, firstId, guest.session.name);
    assert.equal(guestReconnected.state.type, "room-state");
    guestSocket = guestReconnected.socket;
    const guestReconnectedMessage = await hostSawGuestReconnect;
    assert.equal(guestReconnectedMessage.type, "peer-joined");
    assert.equal(guestReconnectedMessage.peer.name, "Guest updated");

    const guestClosed = once(guestSocket, "close");
    const revokeGuest = await app.inject({ method: "DELETE", url: `/device/rooms/${firstId}`, headers: { authorization: `Bearer ${guest.deviceToken}` } });
    assert.equal(revokeGuest.statusCode, 204);
    assert.equal((await guestClosed)[0], 4003);
    assert.deepEqual((await app.inject({ method: "GET", url: "/device/rooms", headers: { authorization: `Bearer ${guest.deviceToken}` } })).json().rooms, []);
    guestSocket = undefined;

    const hostClosed = once(hostSocket, "close");
    const revokeOneRoom = await app.inject({ method: "DELETE", url: `/device/rooms/${firstId}`, headers: { authorization: `Bearer ${primary.deviceToken}` } });
    assert.equal(revokeOneRoom.statusCode, 204);
    assert.equal((await hostClosed)[0], 4003);
    hostSocket = undefined;
    assert.equal((await app.inject({ method: "POST", url: `/device/rooms/${firstId}/session`, headers: { authorization: `Bearer ${primary.deviceToken}` } })).statusCode, 404);
    const remaining = (await app.inject({ method: "GET", url: "/device/rooms", headers: { authorization: `Bearer ${primary.deviceToken}` } })).json().rooms.map((room: { id: string }) => room.id);
    assert.deepEqual(new Set(remaining), new Set([secondId, invitedId]));

    assert.equal((await app.inject({ method: "POST", url: "/admin/rooms", headers: admin, payload: { id: staleEmptyId, name: "Old empty room" } })).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: "/admin/rooms", headers: admin, payload: { id: recentEmptyId, name: "Recent empty room" } })).statusCode, 201);
    await pool.query("UPDATE rooms SET empty_since = now() - interval '31 days' WHERE id = ANY($1::varchar[])", [[firstId, staleEmptyId]]);
    const removed = await new CatalogService(pool).cleanupEmptyRooms(30);
    assert.deepEqual(new Set(removed), new Set([firstId, staleEmptyId]));
    assert.ok(!removed.includes(secondId));
    assert.ok(!removed.includes(recentEmptyId));
    assert.equal((await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: firstId, name: "Old invite", inviteToken: firstInviteToken } })).statusCode, 403);

    // Explicit profile deletion revokes the device's full identity.
    assert.equal((await app.inject({ method: "DELETE", url: `/admin/profiles/${primary.session.userId}`, headers: admin })).statusCode, 204);
  } finally {
    if (guestSocket?.readyState === 1) guestSocket.close();
    if (hostSocket?.readyState === 1) hostSocket.close();
    if (app) await app.close();
    await pool.query("DELETE FROM rooms WHERE id = ANY($1::varchar[])", [testRoomIds]);
    if (testUserIds.length) await pool.query("DELETE FROM guest_profiles WHERE id = ANY($1::uuid[])", [testUserIds]);
    await pool.end();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
