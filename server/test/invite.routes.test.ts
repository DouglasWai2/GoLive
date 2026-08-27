import assert from "node:assert/strict";
import type { Socket } from "node:net";
import { afterEach, beforeEach, test } from "node:test";
import { once } from "node:events";
import type { WebSocket } from "ws";
import { buildApp } from "../src/app.js";

const originalJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
});

afterEach(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

async function createRoom(
  app: Awaited<ReturnType<typeof buildApp>>,
  roomId: string,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/room",
    payload: { roomId, name },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{
    session: {
      kind: "room";
      sessionId: string;
      roomId: string;
      roomInstanceId: string;
      name: string;
    };
    token: string;
  }>();
}

async function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  const [data] = await once(socket, "message");
  return JSON.parse(data.toString()) as Record<string, unknown>;
}

async function connectAndJoin(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  roomId: string,
  name: string,
): Promise<WebSocket> {
  const socket = await app.injectWS("/ws", {
    socket: { remoteAddress: "127.0.0.1" } as Socket,
  });

  const authenticated = nextMessage(socket);
  socket.send(JSON.stringify({ type: "auth", token }));
  assert.deepEqual(await authenticated, { type: "authenticated" });

  const roomState = nextMessage(socket);
  socket.send(JSON.stringify({ type: "join", room: roomId, name }));
  assert.equal((await roomState).type, "room-state");
  return socket;
}

test("binds invites and guest sessions to the current room instance", async () => {
  const app = await buildApp();

  try {
    const host = await createRoom(app, "roomAAAA", " Host ");
    assert.equal(host.session.name, "Host");

    const hostClaims = app.jwt.verify<Record<string, unknown>>(host.token);
    assert.equal(hostClaims.roomId, "roomAAAA");
    assert.equal(hostClaims.roomInstanceId, host.session.roomInstanceId);
    assert.equal(hostClaims.name, "Host");
    assert.equal(hostClaims.host, true);

    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invite",
      headers: { authorization: `Bearer ${host.token}` },
      payload: { roomId: "roomAAAA" },
    });
    assert.equal(inviteResponse.statusCode, 200, inviteResponse.body);
    const { inviteToken } = inviteResponse.json<{ inviteToken: string }>();
    const inviteClaims = app.jwt.verify<Record<string, unknown>>(inviteToken);
    assert.equal(inviteClaims.kind, "invite");
    assert.equal(inviteClaims.roomId, "roomAAAA");
    assert.equal(inviteClaims.roomInstanceId, host.session.roomInstanceId);

    const wrongRoom = await app.inject({
      method: "POST",
      url: "/invite/verify",
      payload: { roomId: "roomBBBB", name: "Guest", inviteToken },
    });
    assert.equal(wrongRoom.statusCode, 403);

    const verified = await app.inject({
      method: "POST",
      url: "/invite/verify",
      payload: { roomId: "roomAAAA", name: " Guest ", inviteToken },
    });
    assert.equal(verified.statusCode, 200, verified.body);
    const guest = verified.json<{
      session: Record<string, unknown>;
      token: string;
    }>();
    const guestClaims = app.jwt.verify<Record<string, unknown>>(guest.token);
    assert.equal(guest.session.roomInstanceId, host.session.roomInstanceId);
    assert.equal(guestClaims.roomInstanceId, host.session.roomInstanceId);
    assert.equal(guestClaims.name, "Guest");
    assert.equal(guestClaims.host, false);
  } finally {
    await app.close();
  }
});

test("rejects non-canonical room IDs instead of normalizing aliases", async () => {
  const app = await buildApp();

  try {
    await createRoom(app, "roomABCD", "Host");

    for (const roomId of [" roomABCD ", "roomABCD\t", "x".repeat(65)]) {
      const response = await app.inject({
        method: "POST",
        url: "/room",
        payload: { roomId, name: "Attacker" },
      });
      assert.equal(response.statusCode, 400, roomId);
    }
  } finally {
    await app.close();
  }
});

test("rejects invite and room tokens after restart and recreation", async () => {
  const oldApp = await buildApp();
  let oldHost!: Awaited<ReturnType<typeof createRoom>>;
  let inviteToken = "";

  try {
    oldHost = await createRoom(oldApp, "roomAAAA", "Host");
    const inviteResponse = await oldApp.inject({
      method: "POST",
      url: "/invite",
      headers: { authorization: `Bearer ${oldHost.token}` },
      payload: { roomId: "roomAAAA" },
    });
    assert.equal(inviteResponse.statusCode, 200, inviteResponse.body);
    inviteToken = inviteResponse.json<{ inviteToken: string }>().inviteToken;
  } finally {
    await oldApp.close();
  }

  const app = await buildApp();
  try {
    const newHost = await createRoom(app, "roomAAAA", "New Host");
    assert.notEqual(
      newHost.session.roomInstanceId,
      oldHost.session.roomInstanceId,
    );

    const staleInviteResponse = await app.inject({
      method: "POST",
      url: "/invite/verify",
      payload: { roomId: "roomAAAA", name: "Guest", inviteToken },
    });
    assert.equal(staleInviteResponse.statusCode, 403);

    const staleSocket = await app.injectWS("/ws", {
      socket: { remoteAddress: "127.0.0.1" } as Socket,
    });
    let authenticated = false;
    staleSocket.on("message", () => {
      authenticated = true;
    });
    const staleClosed = once(staleSocket, "close");
    staleSocket.send(JSON.stringify({ type: "auth", token: oldHost.token }));
    const [code] = await staleClosed;

    assert.equal(code, 4003);
    assert.equal(authenticated, false);
  } finally {
    await app.close();
  }
});

test("repeated join keeps the current room instance active", async () => {
  const app = await buildApp();

  try {
    const host = await createRoom(app, "roomAAAA", "Host");
    const socket = await connectAndJoin(app, host.token, "roomAAAA", "Host");

    socket.send(JSON.stringify({
      type: "join",
      room: "roomAAAA",
      name: "Host",
    }));
    const pong = nextMessage(socket);
    socket.send(JSON.stringify({ type: "ping", timestamp: 123 }));
    assert.deepEqual(await pong, { type: "pong", timestamp: 123 });

    const duplicate = await app.inject({
      method: "POST",
      url: "/room",
      payload: { roomId: "roomAAAA", name: "Attacker" },
    });
    assert.equal(duplicate.statusCode, 403);

    const closed = once(socket, "close");
    socket.close();
    await closed;
  } finally {
    await app.close();
  }
});

test("WebSocket join cannot use a room token for another room", async () => {
  const app = await buildApp();

  try {
    const host = await createRoom(app, "roomAAAA", "Host");
    await createRoom(app, "roomBBBB", "Other");
    const socket = await app.injectWS("/ws", {
      socket: { remoteAddress: "127.0.0.1" } as Socket,
    });

    const authenticated = nextMessage(socket);
    socket.send(JSON.stringify({ type: "auth", token: host.token }));
    assert.deepEqual(await authenticated, { type: "authenticated" });

    const closed = once(socket, "close");
    socket.send(JSON.stringify({
      type: "join",
      room: "roomBBBB",
      name: "Host",
    }));
    const [code] = await closed;
    assert.equal(code, 1008);
  } finally {
    await app.close();
  }
});

test("authorizes and scopes room voice signaling", async () => {
  const app = await buildApp();

  try {
    const host = await createRoom(app, "roomVOICE", "Host");
    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invite",
      headers: { authorization: `Bearer ${host.token}` },
      payload: { roomId: "roomVOICE" },
    });
    const { inviteToken } = inviteResponse.json<{ inviteToken: string }>();
    const guestResponse = await app.inject({
      method: "POST",
      url: "/invite/verify",
      payload: { roomId: "roomVOICE", name: "Guest", inviteToken },
    });
    const guest = guestResponse.json<{ token: string }>();

    const hostSocket = await connectAndJoin(app, host.token, "roomVOICE", "Host");
    const hostJoined = nextMessage(hostSocket);
    const guestSocket = await connectAndJoin(app, guest.token, "roomVOICE", "Guest");
    const joinedMessage = await hostJoined;
    assert.equal(joinedMessage.type, "peer-joined");
    const guestId = (joinedMessage.peer as { id: string }).id;

    const unauthorized = nextMessage(hostSocket);
    hostSocket.send(JSON.stringify({
      type: "signal",
      target: guestId,
      channel: "voice",
      data: { type: "offer", sdp: "not-joined" },
    }));
    assert.equal((await unauthorized).type, "error");

    const invalidChannel = nextMessage(hostSocket);
    hostSocket.send(JSON.stringify({
      type: "signal",
      target: guestId,
      channel: "typo",
      data: { candidate: { candidate: "invalid" } },
    }));
    assert.equal((await invalidChannel).message, "Invalid message.");

    const malformedSignal = nextMessage(hostSocket);
    hostSocket.send(JSON.stringify({
      type: "signal",
      target: guestId,
      channel: "voice",
      data: null,
    }));
    assert.equal((await malformedSignal).message, "Invalid message.");

    const hostAccepted = nextMessage(hostSocket);
    const guestSawHost = nextMessage(guestSocket);
    hostSocket.send(JSON.stringify({
      type: "voice",
      joined: true,
      micMuted: true,
    }));
    assert.deepEqual(await hostAccepted, {
      type: "voice-accepted",
      joined: true,
      micMuted: true,
    });
    assert.equal((await guestSawHost).type, "peer-updated");

    const guestAccepted = nextMessage(guestSocket);
    const hostSawGuest = nextMessage(hostSocket);
    guestSocket.send(JSON.stringify({
      type: "voice",
      joined: true,
      micMuted: true,
    }));
    assert.equal((await guestAccepted).type, "voice-accepted");
    assert.equal((await hostSawGuest).type, "peer-updated");

    const relayed = nextMessage(guestSocket);
    hostSocket.send(JSON.stringify({
      type: "signal",
      target: guestId,
      channel: "voice",
      data: { type: "offer", sdp: "voice-offer" },
    }));
    const signal = await relayed;
    assert.equal(signal.type, "signal");
    assert.equal(signal.channel, "voice");
    assert.deepEqual(signal.data, { type: "offer", sdp: "voice-offer" });

    hostSocket.close();
    guestSocket.close();
  } finally {
    await app.close();
  }
});
