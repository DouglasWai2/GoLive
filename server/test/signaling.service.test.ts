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
  closeCode?: number;
  closeReason?: string;

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    this.emit("sent", message);
  }

  close(code = 1000, reason?: string): void {
    if (this.readyState !== this.OPEN) return;
    this.closeCode = code;
    this.closeReason = reason;
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

function waitFor(socket: FakeWebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  const existing = socket.sent.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("sent", onSent);
      reject(new Error(`Timed out waiting for a signaling message. Recent messages: ${JSON.stringify(socket.sent.slice(-5))}`));
    }, 5000);
    const onSent = (message: Record<string, unknown>) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
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
      selfId: guest.sessionId,
      peers: [{ id: host.sessionId, name: "Host", sharing: false, voiceJoined: false, micMuted: true }],
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

test("closes a signaling socket before its pending message queue can grow without bound", async () => {
  const rooms = new RoomService();
  const host = rooms.createRoomSession("queue-room", "Host");
  assert.ok(host);
  const service = new SignalingService(rooms, (token) => token === "host-token" ? { ...host, host: true } : null);
  const socket = new FakeWebSocket();
  service.handleConnection(socket as unknown as WebSocket, "127.0.0.41");

  try {
    socket.receive({ type: "auth", token: "host-token" });
    await waitForMessage(socket, "authenticated");
    socket.receive({ type: "join", room: "queue-room", name: "Host" });
    await waitForMessage(socket, "room-state");

    for (let timestamp = 0; timestamp < 70; timestamp += 1) {
      socket.receive({ type: "ping", timestamp });
    }

    assert.equal(socket.closeCode, 1008);
  } finally {
    socket.close();
  }
});

test("keeps the per-socket message rate limit while processing messages", async () => {
  const rooms = new RoomService();
  const host = rooms.createRoomSession("rate-room", "Host");
  assert.ok(host);
  const service = new SignalingService(rooms, (token) => token === "host-token" ? { ...host, host: true } : null);
  const socket = new FakeWebSocket();
  service.handleConnection(socket as unknown as WebSocket, "127.0.0.42");

  try {
    socket.receive({ type: "auth", token: "host-token" });
    await waitForMessage(socket, "authenticated");
    socket.receive({ type: "join", room: "rate-room", name: "Host" });
    await waitForMessage(socket, "room-state");

    for (let timestamp = 0; timestamp < 118; timestamp += 1) {
      socket.receive({ type: "ping", timestamp });
      await waitForMessage(socket, "pong", timestamp);
    }
    assert.equal(socket.closeCode, undefined);

    socket.receive({ type: "ping", timestamp: 118 });
    assert.equal(socket.closeCode, 1008);
    assert.equal(socket.closeReason, "Rate limit exceeded");
  } finally {
    socket.close();
  }
});

test("forwards bounded voice candidate batches as individual signals", async () => {
  const rooms = new RoomService();
  const host = rooms.createRoomSession("voice-batch-room", "Host");
  assert.ok(host);
  const guest = rooms.createSession("voice-batch-room", "Guest", host.roomInstanceId);
  const service = new SignalingService(rooms, (token) => {
    if (token === "host-token") return { ...host, host: true };
    if (token === "guest-token") return { ...guest, host: false };
    return null;
  });
  const hostSocket = new FakeWebSocket();
  const guestSocket = new FakeWebSocket();
  service.handleConnection(hostSocket as unknown as WebSocket, "127.0.0.43");
  service.handleConnection(guestSocket as unknown as WebSocket, "127.0.0.44");

  try {
    hostSocket.receive({ type: "auth", token: "host-token" });
    await waitForMessage(hostSocket, "authenticated");
    hostSocket.receive({ type: "join", room: "voice-batch-room", name: "Host" });
    await waitForMessage(hostSocket, "room-state");
    guestSocket.receive({ type: "auth", token: "guest-token" });
    await waitForMessage(guestSocket, "authenticated");
    guestSocket.receive({ type: "join", room: "voice-batch-room", name: "Guest" });
    await waitForMessage(guestSocket, "room-state");
    hostSocket.receive({ type: "voice", joined: true, micMuted: true });
    guestSocket.receive({ type: "voice", joined: true, micMuted: true });
    await waitForMessage(hostSocket, "voice-accepted");
    await waitForMessage(guestSocket, "voice-accepted");

    const candidates = Array.from({ length: 8 }, (_, index) => ({ candidate: `candidate-${index}` }));
    hostSocket.receive({ type: "signal", target: guest.sessionId, channel: "voice", data: { candidates } });
    await waitFor(guestSocket, (message) => message.type === "signal"
      && (message.data as { candidate?: { candidate?: string } }).candidate?.candidate === "candidate-7");
    assert.deepEqual(guestSocket.sent.filter((message) => message.type === "signal").map((message) => message.data),
      candidates.map((candidate) => ({ candidate })));

    hostSocket.receive({ type: "signal", target: guest.sessionId, channel: "voice", data: { candidate: { candidate: "legacy" } } });
    await waitFor(guestSocket, (message) => message.type === "signal"
      && (message.data as { candidate?: { candidate?: string } }).candidate?.candidate === "legacy");

    const invalid = waitFor(hostSocket, (message) => message.type === "error" && message.message === "Invalid message.");
    hostSocket.receive({ type: "signal", target: guest.sessionId, channel: "voice", data: { candidates: [...candidates, candidates[0]] } });
    await invalid;
    assert.equal(guestSocket.sent.filter((message) => message.type === "signal").length, 9);

    const invalidCandidate = waitFor(hostSocket, (message) => message.type === "error"
      && message.message === "Invalid message."
      && hostSocket.sent.filter((sent) => sent.type === "error").length === 2);
    hostSocket.receive({ type: "signal", target: guest.sessionId, channel: "voice", data: {
      candidates: [{ candidate: "candidate-valid" }, { candidate: "candidate-invalid", sdpMid: "x".repeat(257) }],
    } });
    await invalidCandidate;
    assert.equal(guestSocket.sent.filter((message) => message.type === "signal").length, 9);
  } finally {
    hostSocket.close();
    guestSocket.close();
  }
});

test("allows concurrent screen shares and enforces one authorized focused subscription", async () => {
  const rooms = new RoomService();
  const alice = rooms.createRoomSession("multi-stream-room", "Alice");
  assert.ok(alice);
  const bob = rooms.createSession("multi-stream-room", "Bob", alice.roomInstanceId);
  const carol = rooms.createSession("multi-stream-room", "Carol", alice.roomInstanceId);
  const sessions = new Map([
    ["alice-token", alice],
    ["bob-token", bob],
    ["carol-token", carol],
  ]);
  const service = new SignalingService(rooms, (token) => {
    const session = sessions.get(token);
    return session ? { ...session, host: token === "alice-token" } : null;
  });
  const sockets = [new FakeWebSocket(), new FakeWebSocket(), new FakeWebSocket()];
  const identities = [alice, bob, carol];
  const tokens = ["alice-token", "bob-token", "carol-token"];

  try {
    for (let index = 0; index < sockets.length; index += 1) {
      const socket = sockets[index]!;
      const identity = identities[index]!;
      service.handleConnection(socket as unknown as WebSocket, `127.0.0.${index + 40}`);
      socket.receive({ type: "auth", token: tokens[index] });
      await waitForMessage(socket, "authenticated");
      socket.receive({ type: "join", room: "multi-stream-room", name: identity.name });
      await waitForMessage(socket, "room-state");
    }

    const [aliceSocket, bobSocket, carolSocket] = sockets;
    assert.ok(aliceSocket && bobSocket && carolSocket);

    const aliceStarted = waitFor(aliceSocket, (message) => message.type === "sharing-accepted");
    aliceSocket.receive({ type: "sharing", sharing: true });
    const aliceStartAck = await aliceStarted;
    assert.equal(aliceStartAck.sharing, true);
    assert.equal(typeof aliceStartAck.streamId, "string");
    const aliceStreamId = aliceStartAck.streamId as string;

    assert.equal(rooms.getClient("multi-stream-room", alice.sessionId)?.sharing, true);
    assert.equal(rooms.getClient("multi-stream-room", bob.sessionId)?.sharing, false);

    const aliceSubscribed = waitFor(aliceSocket, (message) => (
      message.type === "stream-subscriber"
      && message.peerId === carol.sessionId
      && message.subscribed === true
    ));
    carolSocket.receive({ type: "subscribe", streamId: aliceStreamId });
    assert.equal((await waitFor(carolSocket, (message) => (
      message.type === "subscription-accepted" && message.streamId === aliceStreamId
    ))).streamId, aliceStreamId);
    assert.equal((await aliceSubscribed).streamId, aliceStreamId);

    const bobStarted = waitFor(bobSocket, (message) => message.type === "sharing-accepted");
    bobSocket.receive({ type: "sharing", sharing: true });
    const bobStartAck = await bobStarted;
    assert.equal(bobStartAck.sharing, true);
    assert.equal(typeof bobStartAck.streamId, "string");
    const bobStreamId = bobStartAck.streamId as string;
    assert.notEqual(aliceStreamId, bobStreamId);
    assert.equal(rooms.getClient("multi-stream-room", bob.sessionId)?.sharing, true);

    const aliceStillAuthorized = waitFor(carolSocket, (message) => (
      message.type === "signal"
      && message.from === alice.sessionId
      && message.streamId === aliceStreamId
      && (message.data as Record<string, unknown>).sdp === "first-stream-after-second-start"
    ));
    aliceSocket.receive({
      type: "signal",
      target: carol.sessionId,
      channel: "screen",
      streamId: aliceStreamId,
      data: { type: "offer", sdp: "first-stream-after-second-start" },
    });
    await aliceStillAuthorized;

    const aliceUnsubscribed = waitFor(aliceSocket, (message) => (
      message.type === "stream-subscriber"
      && message.peerId === carol.sessionId
      && message.subscribed === false
    ));
    const bobSubscribed = waitFor(bobSocket, (message) => (
      message.type === "stream-subscriber"
      && message.peerId === carol.sessionId
      && message.subscribed === true
    ));
    carolSocket.receive({ type: "subscribe", streamId: bobStreamId });
    assert.equal((await waitFor(carolSocket, (message) => (
      message.type === "subscription-accepted" && message.streamId === bobStreamId
    ))).streamId, bobStreamId);
    await Promise.all([aliceUnsubscribed, bobSubscribed]);
    assert.equal(
      rooms.getClient("multi-stream-room", carol.sessionId)?.subscribedStreamId,
      bobStreamId,
    );

    const invalidSignal = waitFor(aliceSocket, (message) => (
      message.type === "error" && message.code === "INVALID_STREAM_SIGNAL"
    ));
    aliceSocket.receive({
      type: "signal",
      target: carol.sessionId,
      channel: "screen",
      streamId: aliceStreamId,
      data: { type: "offer", sdp: "unauthorized" },
    });
    const invalidSignalMessage = await invalidSignal;
    assert.equal(invalidSignalMessage.streamId, aliceStreamId);
    assert.equal(invalidSignalMessage.targetPeerId, carol.sessionId);
    assert.equal(carolSocket.sent.some((message) => (
      message.type === "signal"
      && message.from === alice.sessionId
      && (message.data as Record<string, unknown>).sdp === "unauthorized"
    )), false);

    const forwardedOffer = waitFor(carolSocket, (message) => (
      message.type === "signal"
      && message.from === bob.sessionId
      && message.streamId === bobStreamId
    ));
    bobSocket.receive({
      type: "signal",
      target: carol.sessionId,
      channel: "screen",
      streamId: bobStreamId,
      data: { type: "offer", sdp: "authorized-offer" },
    });
    await forwardedOffer;

    const forwardedAnswer = waitFor(bobSocket, (message) => (
      message.type === "signal"
      && message.from === carol.sessionId
      && message.streamId === bobStreamId
    ));
    carolSocket.receive({
      type: "signal",
      target: bob.sessionId,
      channel: "screen",
      streamId: bobStreamId,
      data: { type: "answer", sdp: "authorized-answer" },
    });
    await forwardedAnswer;

    const ended = waitFor(carolSocket, (message) => (
      message.type === "subscription-ended" && message.streamId === bobStreamId
    ));
    bobSocket.receive({ type: "sharing", sharing: false, streamId: bobStreamId });
    await ended;
    assert.equal(rooms.getClient("multi-stream-room", bob.sessionId)?.sharing, false);
    assert.equal(rooms.getClient("multi-stream-room", carol.sessionId)?.subscribedStreamId, undefined);

    const bobRestarted = waitFor(bobSocket, (message) => (
      message.type === "sharing-accepted" && message.sharing === true && message.streamId !== bobStreamId
    ));
    bobSocket.receive({ type: "sharing", sharing: true });
    const newBobStreamId = (await bobRestarted).streamId as string;
    assert.notEqual(newBobStreamId, bobStreamId);

    const staleStop = waitFor(bobSocket, (message) => (
      message.type === "error" && message.code === "STALE_STREAM"
    ));
    bobSocket.receive({ type: "sharing", sharing: false, streamId: bobStreamId });
    await staleStop;
    assert.equal(rooms.getClient("multi-stream-room", bob.sessionId)?.streamId, newBobStreamId);

    const invalidSubscription = waitFor(carolSocket, (message) => (
      message.type === "error" && message.message === "Invalid message."
    ));
    carolSocket.receive({ type: "subscribe", streamId: "not-a-stream-id" });
    await invalidSubscription;
    assert.equal(
      rooms.getClient("multi-stream-room", carol.sessionId)?.subscribedStreamId,
      undefined,
    );

    const bobSubscriber = waitFor(bobSocket, (message) => (
      message.type === "stream-subscriber"
      && message.peerId === carol.sessionId
      && message.subscribed === true
      && message.streamId === newBobStreamId
    ));
    carolSocket.receive({ type: "subscribe", streamId: newBobStreamId });
    await bobSubscriber;
    const streamEnded = waitFor(carolSocket, (message) => (
      message.type === "subscription-ended" && message.streamId === newBobStreamId
    ));
    bobSocket.close();
    await streamEnded;
    assert.equal(rooms.getClient("multi-stream-room", carol.sessionId)?.subscribedStreamId, undefined);
  } finally {
    for (const socket of sockets) socket.close();
  }
});
