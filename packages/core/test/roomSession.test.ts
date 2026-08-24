import assert from "node:assert/strict";
import test from "node:test";
import { RoomSession } from "../src/roomSession";
import type { PlatformAdapter } from "../src/adapter";
import type {
  IceServer,
  RTCPeerConnection,
  SessionDescriptionInit,
  WebSocketLike,
} from "../src/types";

class FakeSocket implements WebSocketLike {
  static instance: FakeSocket | null = null;

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];

  constructor(_url: string) {
    FakeSocket.instance = this;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

class FakePeerConnection {
  signalingState = "stable";
  connectionState: "new" | "failed" | "closed" = "new";
  iceConnectionState = "new";
  iceGatheringState = "new";
  localDescription: SessionDescriptionInit | null = null;
  remoteDescription: SessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onicecandidateerror: ((event: unknown) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: never[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  addTrack(): void {}
  async addIceCandidate(): Promise<void> {}
  async createOffer(): Promise<SessionDescriptionInit> {
    return { type: "offer", sdp: "offer" };
  }
  async createAnswer(): Promise<SessionDescriptionInit> {
    return { type: "answer", sdp: "answer" };
  }
  async setLocalDescription(description: SessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    this.signalingState = "stable";
  }
  async setRemoteDescription(description: SessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  getSenders(): never[] {
    return [];
  }
  async getStats() {
    return {
      forEach: () => {},
      get: () => undefined,
    };
  }
  close(): void {
    this.connectionState = "closed";
    this.signalingState = "closed";
  }
  fail(): void {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("joins without TURN and only the elected owner pings", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("TURN should not be requested while joining");
  };

  const adapter = {} as PlatformAdapter;
  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onLocalStream: () => {},
      onIsStartingShare: () => {},
      onRemoteStream: () => {},
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: () => {},
    },
    { baseUrl: "https://signal.example.com", adapter },
  );

  try {
    session.start("room-id", "Owner", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    assert.equal(fetchCount, 0);

    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({
      type: "room-state",
      selfId: "self",
      isHost: false,
      heartbeatOwnerId: "other",
      peers: [],
    });

    assert.equal(socket.sent.filter((message) => message.type === "ping").length, 0);

    socket.receive({ type: "heartbeat-owner", peerId: "self" });
    assert.equal(socket.sent.filter((message) => message.type === "ping").length, 1);

    socket.receive({ type: "pong", timestamp: Date.now() });
    assert.equal(fetchCount, 0);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    FakeSocket.instance = null;
  }
});

test("clears a session rejected after WebSocket authentication", () => {
  const originalWebSocket = globalThis.WebSocket;
  let rejected = 0;
  const errors: string[] = [];

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onLocalStream: () => {},
      onIsStartingShare: () => {},
      onRemoteStream: () => {},
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: (message) => {
        if (message) errors.push(message);
      },
      onSessionRejected: () => {
        rejected += 1;
      },
    },
    { baseUrl: "https://signal.example.com", adapter: {} as PlatformAdapter },
  );

  try {
    session.start("room-id", "Guest", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.onclose?.({ code: 4003 });

    assert.equal(rejected, 1);
    assert.deepEqual(errors, []);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});

test("requests TURN only after direct ICE fails and rebuilds the viewer", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const connections: FakePeerConnection[] = [];
  const configurations: IceServer[][] = [];
  let fetchCount = 0;

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({
      iceServers: [{
        urls: "turn:turn.example.com:3478",
        username: "temporary-user",
        credential: "temporary-password",
      }],
    });
  };

  const adapter = {
    createPeerConnection: ({ iceServers }: { iceServers: IceServer[] }) => {
      configurations.push(iceServers);
      const connection = new FakePeerConnection();
      connections.push(connection);
      return connection as unknown as RTCPeerConnection;
    },
  } as PlatformAdapter;
  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onLocalStream: () => {},
      onIsStartingShare: () => {},
      onRemoteStream: () => {},
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: () => {},
    },
    { baseUrl: "https://signal.example.com", adapter },
  );

  try {
    session.start("room-id", "Viewer", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({
      type: "room-state",
      selfId: "viewer",
      isHost: false,
      heartbeatOwnerId: "sharer",
      peers: [{ id: "sharer", name: "Sharer", sharing: true }],
    });
    socket.receive({
      type: "signal",
      from: "sharer",
      data: { type: "offer", sdp: "direct-offer" },
    });
    await flushAsyncWork();

    assert.equal(fetchCount, 0);
    assert.equal(connections.length, 1);
    assert.equal(
      configurations[0]?.some((server) => String(server.urls).startsWith("turn:")),
      false,
    );

    connections[0]!.fail();
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(fetchCount, 1);
    assert.ok(socket.sent.some((message) => {
      const data = message.data as Record<string, unknown> | undefined;
      return message.type === "signal" && data?.restartRequest === true;
    }));

    socket.receive({
      type: "signal",
      from: "sharer",
      data: { type: "offer", sdp: "relay-offer" },
    });
    await flushAsyncWork();

    assert.equal(connections.length, 2);
    assert.equal(
      configurations[1]?.some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => url.startsWith("turn:"));
      }),
      true,
    );
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    FakeSocket.instance = null;
  }
});
