import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Socket } from "node:net";
import type { WebSocket } from "ws";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

const id = () => `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

test("device membership persists; invites grant only one room at a time and leaving revokes access", {
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
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  try {
    app = await buildApp();
    const admin = { authorization: `Bearer ${app.jwt.sign({ kind: "admin" }, { expiresIn: 3600 })}` };
    const create = await app.inject({ method: "POST", url: "/room", payload: { roomId: firstId, name: "Host" } });
    assert.equal(create.statusCode, 200, create.body);
    const host = create.json<{ token: string; deviceToken: string; session: { userId: string } }>();
    assert.ok(host.deviceToken);
    assert.equal((await app.inject({ method: "POST", url: "/room", payload: { roomId: firstId, name: "Intruder" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/admin/profiles", headers: admin })).json().profiles.some((p: { id: string }) => p.id === host.session.userId), true);
    assert.equal((await app.inject({ method: "GET", url: `/admin/rooms/${firstId}`, headers: admin })).json().name, `Room ${firstId}`);
    assert.equal((await app.inject({ method: "DELETE", url: `/admin/rooms/${firstId}`, headers: admin })).statusCode, 409);
    assert.equal((await app.inject({ method: "GET", url: "/device/room", headers: { authorization: "Bearer fake" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/device/room", headers: { authorization: `Bearer ${host.deviceToken}` } })).json().session.roomId, firstId);

    const inviteResponse = await app.inject({ method: "POST", url: "/invite", headers: { authorization: `Bearer ${host.token}` }, payload: { roomId: firstId } });
    assert.equal(inviteResponse.statusCode, 200, inviteResponse.body);
    const { inviteToken } = inviteResponse.json<{ inviteToken: string }>();
    assert.equal((await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: secondId, name: "Guest", inviteToken } })).statusCode, 403);
    const guestResponse = await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: firstId, name: "Guest", inviteToken } });
    assert.equal(guestResponse.statusCode, 200, guestResponse.body);
    const guest = guestResponse.json<{ token: string; deviceToken: string }>();
    assert.notEqual(guest.deviceToken, host.deviceToken);

    await app.close();
    app = await buildApp();
    const renewed = await app.inject({ method: "GET", url: "/device/room", headers: { authorization: `Bearer ${guest.deviceToken}` } });
    assert.equal(renewed.statusCode, 200);
    assert.equal(renewed.json().session.roomId, firstId);
    assert.notEqual(renewed.json().token, guest.token);
    const socket: WebSocket = await app.injectWS("/ws", { socket: { remoteAddress: "127.0.0.1" } as Socket });
    const authenticated = once(socket, "message");
    socket.send(JSON.stringify({ type: "auth", token: renewed.json().token }));
    assert.equal(JSON.parse((await authenticated)[0].toString()).type, "authenticated");
    const roomState = once(socket, "message");
    socket.send(JSON.stringify({ type: "join", room: firstId, name: "Guest" }));
    assert.equal(JSON.parse((await roomState)[0].toString()).type, "room-state");
    // An invite remains valid after a restart, even if nobody is connected.
    const anotherGuest = await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: firstId, name: "Second guest", inviteToken } });
    assert.equal(anotherGuest.statusCode, 200, anotherGuest.body);

    const otherRoom = await app.inject({ method: "POST", url: "/room", payload: { roomId: secondId, name: "Other owner" } });
    assert.equal(otherRoom.statusCode, 200, otherRoom.body);
    const otherInvite = await app.inject({ method: "POST", url: "/invite", headers: { authorization: `Bearer ${otherRoom.json().token}` }, payload: { roomId: secondId } });
    const secondInvite = otherInvite.json().inviteToken as string;
    const invalidSwitch = await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: secondId, name: "Guest", inviteToken: "invalid", deviceToken: guest.deviceToken } });
    assert.equal(invalidSwitch.statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/device/room", headers: { authorization: `Bearer ${guest.deviceToken}` } })).json().session.roomId, firstId);
    const disconnected = once(socket, "close");
    const switched = await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: secondId, name: "Guest", inviteToken: secondInvite, deviceToken: guest.deviceToken } });
    assert.equal(switched.statusCode, 200, switched.body);
    assert.equal((await disconnected)[0], 4003);
    const staleSocket: WebSocket = await app.injectWS("/ws", { socket: { remoteAddress: "127.0.0.1" } as Socket });
    const staleClose = once(staleSocket, "close");
    staleSocket.send(JSON.stringify({ type: "auth", token: renewed.json().token }));
    assert.equal((await staleClose)[0], 4003);
    assert.equal(switched.json().deviceToken, guest.deviceToken);
    assert.equal((await app.inject({ method: "GET", url: "/device/room", headers: { authorization: `Bearer ${guest.deviceToken}` } })).json().session.roomId, secondId);
    assert.equal((await app.inject({ method: "POST", url: "/room", payload: { roomId: id(), name: "Extra", deviceToken: guest.deviceToken } })).statusCode, 409);

    const leave = await app.inject({ method: "DELETE", url: "/device/room", headers: { authorization: `Bearer ${host.deviceToken}` } });
    assert.equal(leave.statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: "/device/room", headers: { authorization: `Bearer ${host.deviceToken}` } })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/invite", headers: { authorization: `Bearer ${host.token}` }, payload: { roomId: firstId } })).statusCode, 403);
    // Members keep the original room after its creator leaves.
    assert.equal((await app.inject({ method: "GET", url: "/device/room", headers: { authorization: `Bearer ${anotherGuest.json().deviceToken}` } })).json().session.roomId, firstId);
    assert.equal((await app.inject({ method: "DELETE", url: "/device/room", headers: { authorization: `Bearer ${anotherGuest.json().deviceToken}` } })).statusCode, 204);
    const recreated = await app.inject({ method: "POST", url: "/room", payload: { roomId: firstId, name: "New owner", deviceToken: host.deviceToken } });
    assert.equal(recreated.statusCode, 200, recreated.body);
    assert.equal(recreated.json().session.name, "New owner");
    assert.equal((await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: firstId, name: "Old link", inviteToken } })).statusCode, 403);

    const adminHeaders = { authorization: `Bearer ${app.jwt.sign({ kind: "admin" }, { expiresIn: 3600 })}` };
    assert.equal((await app.inject({ method: "POST", url: "/admin/profiles", headers: adminHeaders, payload: { name: "Directory entry" } })).statusCode, 201);
    const adminRoomId = id();
    assert.equal((await app.inject({ method: "POST", url: "/admin/rooms", headers: adminHeaders, payload: { id: adminRoomId, name: "Meeting" } })).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: "/room", payload: { roomId: adminRoomId, name: "Guess" } })).statusCode, 403);
    const adminInvite = await app.inject({ method: "POST", url: `/admin/rooms/${adminRoomId}/invite`, headers: adminHeaders });
    assert.equal(adminInvite.statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/invite/verify", payload: { roomId: adminRoomId, name: "Invited", inviteToken: adminInvite.json().inviteToken } })).statusCode, 200);
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
