import assert from "node:assert/strict";
import test from "node:test";
import { RoomSession } from "../src/roomSession";
import { DEFAULT_SHARE_SETTINGS } from "../src/sharePresets";
import type { PlatformAdapter } from "../src/adapter";
import type {
  IceServer,
  IceCandidateInit,
  MediaStream,
  MediaTrack,
  ShareSettings,
  RTCPeerConnection,
  RTCRtpSender,
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
  ontrack: ((event: { track: MediaTrack; streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly sender: RTCRtpSender = {
    track: null,
    getParameters: () => ({}),
    setParameters: async () => {},
    replaceTrack: async (track) => {
      this.sender.track = track;
    },
  };
  transceiverCount = 0;
  readonly transceivers: Array<{ sender: RTCRtpSender; direction: string }> = [];
  readonly addedTracks: Array<{ track: MediaTrack; stream: MediaStream }> = [];
  statsCallCount = 0;

  addTrack(track: MediaTrack, stream: MediaStream): void {
    this.addedTracks.push({ track, stream });
  }
  addTransceiver(
    _kind: "audio" | "video",
    init?: { direction?: "sendrecv" | "sendonly" | "recvonly" | "inactive" },
  ) {
    this.transceiverCount += 1;
    const transceiver = {
      sender: this.sender,
      direction: init?.direction ?? "sendrecv",
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }
  async addIceCandidate(): Promise<void> {}
  async createOffer(): Promise<SessionDescriptionInit> {
    return { type: "offer", sdp: "offer" };
  }
  async createAnswer(): Promise<SessionDescriptionInit> {
    return { type: "answer", sdp: "answer" };
  }
  async setLocalDescription(description: SessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description: SessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  getSenders(): never[] {
    return [];
  }
  async getStats() {
    this.statsCallCount += 1;
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

class FakeMediaTrack {
  readonly id = "screen-track";
  readonly kind = "video";
  enabled = true;
  readyState: "live" | "ended" = "live";
  stopCount = 0;

  addEventListener(): void {}

  stop(): void {
    this.stopCount += 1;
    this.readyState = "ended";
  }
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("joins without TURN and keeps every room WebSocket alive", () => {
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
      selfId: "owner",
      peers: [],
    });

    const pings = () => socket.sent.filter((message) => message.type === "ping");
    assert.equal(pings().length, 1);
    socket.receive({ type: "pong", timestamp: pings()[0]?.timestamp });

    session.resume();
    assert.equal(pings().length, 2);
    assert.equal(socket.sent.some((message) => message.type === "heartbeat-reclaim"), false);

    socket.receive({ type: "pong", timestamp: pings()[1]?.timestamp });
    assert.equal(fetchCount, 0);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    FakeSocket.instance = null;
  }
});

test("limits per-viewer stats polling overhead while sharing to multiple viewers", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const connections: FakePeerConnection[] = [];
  const viewerCounts: number[] = [];
  const track = new FakeMediaTrack();
  const stream: MediaStream = {
    id: "polling-benchmark-stream",
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  };

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.setInterval = ((callback: () => void, delayMs = 0) => {
    timers.push({ callback, delayMs });
    return timers.length as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;

  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onLocalStream: () => {},
      onLocalViewerCount: (count) => viewerCounts.push(count),
      onIsStartingShare: () => {},
      onRemoteStream: () => {},
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: () => {},
    },
    {
      baseUrl: "https://signal.example.com",
      adapter: {
        getDisplayMedia: async () => stream,
        createPeerConnection: () => {
          const connection = new FakePeerConnection();
          connections.push(connection);
          return connection as unknown as RTCPeerConnection;
        },
      } as PlatformAdapter,
    },
  );

  try {
    session.start("room-id", "Sharer", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({ type: "room-state", selfId: "sharer", peers: [] });

    const share = session.startSharing(DEFAULT_SHARE_SETTINGS);
    await flushAsyncWork();
    socket.receive({
      type: "sharing-accepted",
      sharing: true,
      streamId: "polling-benchmark-stream-id",
    });
    await share;

    for (const peerId of ["viewer-1", "viewer-2", "viewer-3"]) {
      socket.receive({
        type: "stream-subscriber",
        peerId,
        streamId: "polling-benchmark-stream-id",
        subscribed: true,
      });
    }
    assert.deepEqual(viewerCounts, [1, 2, 3]);
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(connections.length, 3);
    const peerStatsTimers = timers.filter((timer) => timer.delayMs < 10_000);
    assert.equal(peerStatsTimers.length, 3);
    assert.deepEqual(peerStatsTimers.map((timer) => timer.delayMs), [2_000, 2_000, 2_000]);

    // Deterministic 10-second virtual run: the per-viewer timer drives one
    // getStats() call per active connection per tick.
    for (let elapsedMs = 1_000; elapsedMs <= 10_000; elapsedMs += 1_000) {
      for (const timer of peerStatsTimers) {
        if (elapsedMs % timer.delayMs === 0) timer.callback();
      }
      await flushAsyncWork();
    }

    const callsAfterChange = connections.reduce(
      (total, connection) => total + connection.statsCallCount,
      0,
    );
    // The pre-change run measured 10 samples/peer (30 total) over 10 seconds.
    const baselineCallsAtOneSecondCadence = connections.length * 10;

    assert.deepEqual(connections.map((connection) => connection.statsCallCount), [5, 5, 5]);
    assert.equal(callsAfterChange, 15);
    assert.equal(callsAfterChange, baselineCallsAtOneSecondCadence / 2);

    socket.receive({
      type: "stream-subscriber",
      peerId: "viewer-2",
      streamId: "polling-benchmark-stream-id",
      subscribed: false,
    });
    assert.deepEqual(viewerCounts, [1, 2, 3, 2]);

    session.stopSharing();
    assert.deepEqual(viewerCounts, [1, 2, 3, 2, 0]);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    FakeSocket.instance = null;
  }
});

test("reports semantic peer lifecycle changes without replaying room state", () => {
  const originalWebSocket = globalThis.WebSocket;
  const joined: string[] = [];
  const left: string[] = [];
  const sharing: boolean[] = [];

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onPeerJoined: (peer) => joined.push(peer.name),
      onPeerLeft: (peer) => left.push(peer.name),
      onPeerSharingChanged: (peer) => sharing.push(peer.sharing),
      onLocalStream: () => {},
      onIsStartingShare: () => {},
      onRemoteStream: () => {},
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: () => {},
    },
    { baseUrl: "https://signal.example.com", adapter: {} as PlatformAdapter },
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
      peers: [{
        id: "existing",
        name: "Existing",
        sharing: false,
        voiceJoined: false,
        micMuted: true,
      }],
    });

    assert.deepEqual(joined, []);
    assert.deepEqual(sharing, []);

    const existing = {
      id: "existing",
      name: "Existing",
      sharing: true,
      voiceJoined: false,
      micMuted: true,
    };
    socket.receive({ type: "peer-updated", peer: existing });
    socket.receive({ type: "peer-updated", peer: existing });
    socket.receive({ type: "peer-updated", peer: { ...existing, sharing: false } });

    assert.deepEqual(sharing, [true, false]);

    const newcomer = {
      id: "newcomer",
      name: "Newcomer",
      sharing: false,
      voiceJoined: false,
      micMuted: true,
    };
    socket.receive({ type: "peer-joined", peer: newcomer });
    socket.receive({ type: "peer-joined", peer: newcomer });
    socket.receive({ type: "peer-left", peerId: "unknown" });
    socket.receive({ type: "peer-left", peerId: newcomer.id });
    socket.receive({ type: "peer-left", peerId: newcomer.id });

    assert.deepEqual(joined, ["Newcomer"]);
    assert.deepEqual(left, ["Newcomer"]);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});

test("clears a session rejected before WebSocket authentication", () => {
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
    socket.onclose?.({ code: 4003 });

    assert.equal(rejected, 1);
    assert.deepEqual(errors, []);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});

test("keeps captured media alive and restores sharing after signaling reconnects", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const track = new FakeMediaTrack();
  const stream = {
    id: "screen-stream",
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
  const adapter = {
    getDisplayMedia: async () => stream,
  } as unknown as PlatformAdapter;
  const localStreams: Array<MediaStream | null> = [];

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onLocalStream: (localStream) => localStreams.push(localStream),
      onIsStartingShare: () => {},
      onRemoteStream: () => {},
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: () => {},
    },
    { baseUrl: "https://signal.example.com", adapter },
  );
  const settings: ShareSettings = {
    width: 1280,
    height: 720,
    frameRate: 30,
    maxBitrate: 4_000_000,
    includeAudio: false,
  };

  try {
    session.start("room-id", "Sharer", "room-token");
    const firstSocket = FakeSocket.instance;
    assert.ok(firstSocket);
    firstSocket.open();
    firstSocket.receive({ type: "authenticated" });
    firstSocket.receive({
      type: "room-state",
      selfId: "sharer",
      peers: [],
    });

    const startSharing = session.startSharing(settings);
    await flushAsyncWork();
    firstSocket.receive({
      type: "sharing-accepted",
      sharing: true,
      streamId: "11111111-1111-4111-8111-111111111111",
    });
    await startSharing;
    assert.equal(localStreams.at(-1), stream);

    firstSocket.readyState = 3;
    firstSocket.onclose?.({ code: 1006 });
    assert.equal(track.stopCount, 0);

    session.resume();
    const reconnectedSocket = FakeSocket.instance;
    assert.ok(reconnectedSocket);
    assert.notEqual(reconnectedSocket, firstSocket);
    reconnectedSocket.open();
    reconnectedSocket.receive({ type: "authenticated" });
    reconnectedSocket.receive({
      type: "room-state",
      selfId: "sharer",
      peers: [],
    });
    assert.ok(reconnectedSocket.sent.some((message) => (
      message.type === "sharing" && message.sharing === true
    )));

    reconnectedSocket.receive({
      type: "sharing-accepted",
      sharing: true,
      streamId: "22222222-2222-4222-8222-222222222222",
    });
    await flushAsyncWork();
    assert.equal(track.stopCount, 0);
    assert.equal(localStreams.at(-1), stream);
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
  const purposes: Array<"screen" | "voice"> = [];
  const streamId = "33333333-3333-4333-8333-333333333333";
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
    createPeerConnection: ({ iceServers, purpose }: {
      iceServers: IceServer[];
      purpose: "screen" | "voice";
    }) => {
      configurations.push(iceServers);
      purposes.push(purpose);
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
      peers: [{
        id: "sharer",
        name: "Sharer",
        sharing: true,
        streamId,
        voiceJoined: false,
        micMuted: true,
      }],
    });
    session.focusPeer("sharer");
    socket.receive({
      type: "signal",
      from: "sharer",
      channel: "screen",
      streamId,
      data: { type: "offer", sdp: "direct-offer" },
    });
    await flushAsyncWork();

    assert.equal(fetchCount, 0);
    assert.equal(connections.length, 1);
    assert.equal(purposes[0], "screen");
    assert.equal(
      configurations[0]?.some((server) => String(server.urls).startsWith("turn:")),
      false,
    );

    connections[0]!.fail();
    await flushAsyncWork();
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
      channel: "screen",
      streamId,
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

test("auto-joins voice muted and requests the microphone only on unmute", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const connections: FakePeerConnection[] = [];
  const purposes: Array<"screen" | "voice"> = [];
  let microphoneRequests = 0;
  const microphoneTracks: MediaTrack[] = [];
  const microphoneStopCounts: number[] = [];
  const displayTrack: MediaTrack = {
    id: "display-video",
    kind: "video",
    enabled: true,
    stop: () => {},
    addEventListener: () => {},
  };
  const displayStream: MediaStream = {
    id: "display-stream",
    getTracks: () => [displayTrack],
    getVideoTracks: () => [displayTrack],
    getAudioTracks: () => [],
  };
  let resolveDisplay!: (stream: MediaStream) => void;
  const displayRequest = new Promise<MediaStream>((resolve) => {
    resolveDisplay = resolve;
  });

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.fetch = async () => Response.json({
    iceServers: [{
      urls: "turn:turn.example.com:3478",
      username: "voice-user",
      credential: "voice-password",
    }],
  });

  const adapter = {
    getDisplayMedia: () => displayRequest,
    getUserMedia: async () => {
      microphoneRequests += 1;
      const requestIndex = microphoneTracks.length;
      microphoneStopCounts.push(0);
      const microphoneTrack: MediaTrack = {
        id: `microphone-${requestIndex}`,
        kind: "audio",
        enabled: false,
        stop: () => {
          microphoneStopCounts[requestIndex] = (microphoneStopCounts[requestIndex] ?? 0) + 1;
        },
        addEventListener: () => {},
      };
      microphoneTracks.push(microphoneTrack);
      return {
        id: `microphone-stream-${requestIndex}`,
        getTracks: () => [microphoneTrack],
        getVideoTracks: () => [],
        getAudioTracks: () => [microphoneTrack],
      };
    },
    isCaptureRejected: () => false,
    serializeCandidate: (candidate) => candidate as IceCandidateInit,
    createPeerConnection: ({ purpose }: {
      iceServers: IceServer[];
      purpose: "screen" | "voice";
    }) => {
      purposes.push(purpose);
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
    session.start("room-id", "Listener", "room-token");
    session.joinVoice();
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({
      type: "room-state",
      selfId: "a",
      peers: [{
        id: "b",
        name: "Speaker",
        sharing: false,
        voiceJoined: true,
        micMuted: false,
      }],
    });

    assert.equal(microphoneRequests, 0);
    assert.ok(socket.sent.some((message) =>
      message.type === "voice"
      && message.joined === true
      && message.micMuted === true,
    ));

    socket.receive({ type: "voice-accepted", joined: true, micMuted: true });
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(connections.length, 1);
    assert.equal(purposes[0], "voice");
    assert.equal(connections[0]?.transceiverCount, 1);
    assert.equal(connections[0]?.transceivers[0]?.direction, "recvonly");
    assert.ok(socket.sent.some((message) =>
      message.type === "signal" && message.channel === "voice",
    ));
    assert.equal(microphoneRequests, 0);

    socket.receive({
      type: "signal",
      from: "b",
      channel: "voice",
      data: { type: "answer", sdp: "answer" },
    });
    await flushAsyncWork();

    for (let index = 0; index < 113; index += 1) {
      connections[0]?.onicecandidate?.({ candidate: { candidate: `candidate-${index}` } });
    }
    await new Promise((resolve) => setTimeout(resolve, 550));
    const candidateBatches = socket.sent.filter((message) => message.type === "signal"
      && message.channel === "voice" && Array.isArray((message.data as { candidates?: unknown[] }).candidates));
    assert.equal(candidateBatches.length, 15);
    assert.deepEqual(candidateBatches.flatMap((message) => (message.data as { candidates: IceCandidateInit[] }).candidates),
      Array.from({ length: 113 }, (_, index) => ({ candidate: `candidate-${index}` })));
    assert.ok(candidateBatches.every((message) => (message.data as { candidates: unknown[] }).candidates.length <= 8));

    const voiceOffersBeforeUnmute = socket.sent.filter((message) =>
      message.type === "signal" && message.channel === "voice",
    ).length;

    await session.setMicrophoneMuted(false);
    await flushAsyncWork();

    assert.equal(microphoneRequests, 1);
    assert.equal(microphoneTracks[0]?.enabled, true);
    assert.equal(connections[0]?.sender.track, microphoneTracks[0]);
    assert.equal(connections[0]?.transceivers[0]?.direction, "sendrecv");
    assert.ok(socket.sent.filter((message) =>
      message.type === "signal" && message.channel === "voice",
    ).length > voiceOffersBeforeUnmute);
    assert.ok(socket.sent.some((message) =>
      message.type === "voice" && message.micMuted === false,
    ));

    await session.setMicrophoneMuted(true);
    assert.equal(microphoneTracks[0]?.enabled, false);
    assert.equal(microphoneStopCounts[0], 1);
    assert.equal(connections[0]?.sender.track, null);
    assert.equal(connections[0]?.transceivers[0]?.direction, "recvonly");

    await session.setMicrophoneMuted(false);
    assert.equal(microphoneRequests, 2);
    assert.equal(microphoneTracks[1]?.enabled, true);
    assert.equal(connections[0]?.sender.track, microphoneTracks[1]);
    assert.equal(connections[0]?.transceivers[0]?.direction, "sendrecv");

    const sharing = session.startSharing(DEFAULT_SHARE_SETTINGS);
    session.handleAppBackground();
    assert.equal(microphoneTracks[1]?.enabled, true);

    session.stopSharing();
    resolveDisplay(displayStream);
    await sharing;

    session.handleAppBackground();
    assert.equal(microphoneTracks[1]?.enabled, false);
    assert.equal(microphoneStopCounts[1], 1);
    assert.equal(connections[0]?.sender.track, null);
    assert.equal(connections[0]?.transceivers[0]?.direction, "recvonly");
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    FakeSocket.instance = null;
  }
});

test("keeps a late viewer screen offer alive across voice state updates", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const connections: FakePeerConnection[] = [];

  const videoTrack: MediaTrack = {
    id: "display-video",
    kind: "video",
    enabled: true,
    stop: () => {},
    addEventListener: () => {},
  };
  const displayStream: MediaStream = {
    id: "display-stream",
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [],
  };
  const streamId = "44444444-4444-4444-8444-444444444444";

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const adapter = {
    getDisplayMedia: async () => displayStream,
    isCaptureRejected: () => false,
    serializeCandidate: () => ({}),
    createPeerConnection: () => {
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
    session.start("room-id", "Sharer", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({
      type: "room-state",
      selfId: "sharer",
      peers: [],
    });

    const sharing = session.startSharing({
      ...DEFAULT_SHARE_SETTINGS,
      includeAudio: false,
    });
    await flushAsyncWork();
    socket.receive({ type: "sharing-accepted", sharing: true, streamId });
    await sharing;

    const viewer = {
      id: "viewer",
      name: "Viewer",
      sharing: false,
      voiceJoined: false,
      micMuted: true,
    };
    socket.receive({ type: "peer-joined", peer: viewer });
    socket.receive({
      type: "stream-subscriber",
      peerId: viewer.id,
      streamId,
      subscribed: true,
    });
    socket.receive({
      type: "peer-updated",
      peer: { ...viewer, voiceJoined: true },
    });
    await flushAsyncWork();

    assert.equal(connections.length, 1);
    assert.notEqual(connections[0]?.signalingState, "closed");
    assert.ok(socket.sent.some((message) => {
      const data = message.data as Record<string, unknown> | undefined;
      return message.type === "signal"
        && message.target === viewer.id
        && data?.type === "offer";
    }));

    socket.receive({
      type: "signal",
      from: viewer.id,
      channel: "screen",
      streamId,
      data: { type: "answer", sdp: "late-viewer-answer" },
    });
    await flushAsyncWork();
    assert.equal(connections[0]?.remoteDescription?.sdp, "late-viewer-answer");

    socket.receive({
      type: "peer-updated",
      peer: { ...viewer, voiceJoined: true, micMuted: false },
    });
    assert.notEqual(connections[0]?.signalingState, "closed");
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});

test("keeps the focused screen subscribed when another sharer starts and refreshes a rejected subscription", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const connections: FakePeerConnection[] = [];
  const errors: string[] = [];
  const firstStreamId = "66666666-6666-4666-8666-666666666661";
  const secondStreamId = "66666666-6666-4666-8666-666666666662";

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const adapter = {
    getDisplayMedia: async () => { throw new Error("not used"); },
    isCaptureRejected: () => false,
    serializeCandidate: () => ({ candidate: "candidate" }),
    createPeerConnection: () => {
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
      onError: (message) => errors.push(message),
    },
    { baseUrl: "https://signal.example.com", adapter },
  );

  try {
    session.start("room-id", "Web viewer", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    const firstSharer = {
      id: "native-one",
      name: "Native one",
      sharing: true,
      streamId: firstStreamId,
      voiceJoined: false,
      micMuted: true,
    };
    socket.receive({
      type: "room-state",
      selfId: "web-viewer",
      peers: [firstSharer],
    });

    session.focusPeer(firstSharer.id);
    assert.ok(socket.sent.some((message) => (
      message.type === "subscribe" && message.streamId === firstStreamId
    )));
    socket.receive({ type: "subscription-accepted", streamId: firstStreamId });
    socket.receive({
      type: "signal",
      from: firstSharer.id,
      channel: "screen",
      streamId: firstStreamId,
      data: { type: "offer", sdp: "first-offer" },
    });
    await flushAsyncWork();
    assert.equal(connections.length, 1);

    socket.receive({
      type: "peer-updated",
      peer: {
        id: "native-two",
        name: "Native two",
        sharing: true,
        streamId: secondStreamId,
        voiceJoined: false,
        micMuted: true,
      },
    });
    assert.equal(connections[0]?.connectionState, "new");
    assert.equal(socket.sent.some((message) => (
      message.type === "subscribe" && message.streamId === secondStreamId
    )), false);
    assert.equal(socket.sent.some((message) => (
      message.type === "subscribe" && message.streamId === null
    )), false);

    connections[0]?.onicecandidate?.({ candidate: { candidate: "late-candidate" } });
    assert.ok(socket.sent.some((message) => (
      message.type === "signal"
      && message.streamId === firstStreamId
      && message.target === firstSharer.id
    )));

    socket.receive({
      type: "error",
      code: "INVALID_STREAM_SIGNAL",
      message: "This screen-sharing signal is not authorized.",
      streamId: firstStreamId,
      targetPeerId: firstSharer.id,
    });
    assert.equal(socket.sent.filter((message) => (
      message.type === "subscribe" && message.streamId === firstStreamId
    )).length, 2);
    assert.deepEqual(errors.filter(Boolean), []);

    socket.receive({ type: "subscription-accepted", streamId: firstStreamId });
    socket.receive({
      type: "signal",
      from: firstSharer.id,
      channel: "screen",
      streamId: firstStreamId,
      data: { type: "offer", sdp: "recovered-offer" },
    });
    await flushAsyncWork();
    assert.equal(connections.length, 1);
    assert.equal(connections[0]?.remoteDescription?.sdp, "recovered-offer");
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});

test("defaults display audio on and publishes the captured audio track", async () => {
  const originalWebSocket = globalThis.WebSocket;
  let requestedConstraints: Parameters<PlatformAdapter["getDisplayMedia"]>[0] | null = null;
  let publishedStream: MediaStream | null = null;
  const connections: FakePeerConnection[] = [];

  const videoTrack: MediaTrack = {
    id: "display-video",
    kind: "video",
    enabled: true,
    stop: () => {},
    addEventListener: () => {},
  };
  const audioTrack: MediaTrack = {
    id: "display-audio",
    kind: "audio",
    enabled: true,
    stop: () => {},
    addEventListener: () => {},
  };
  const displayStream: MediaStream = {
    id: "display-stream",
    getTracks: () => [videoTrack, audioTrack],
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [audioTrack],
  };
  const streamId = "55555555-5555-4555-8555-555555555555";

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const adapter = {
    getDisplayMedia: async (constraints: Parameters<PlatformAdapter["getDisplayMedia"]>[0]) => {
      requestedConstraints = constraints;
      return displayStream;
    },
    isCaptureRejected: () => false,
    serializeCandidate: () => ({}),
    createPeerConnection: () => {
      const connection = new FakePeerConnection();
      connections.push(connection);
      return connection as unknown as RTCPeerConnection;
    },
  } as PlatformAdapter;
  const session = new RoomSession(
    {
      onStatus: () => {},
      onPeers: () => {},
      onLocalStream: (stream) => {
        publishedStream = stream;
      },
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
    assert.equal(DEFAULT_SHARE_SETTINGS.includeAudio, true);
    session.start("room-id", "Sharer", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({
      type: "room-state",
      selfId: "sharer",
      peers: [{
        id: "viewer",
        name: "Viewer",
        sharing: false,
        voiceJoined: false,
        micMuted: true,
      }],
    });

    const sharing = session.startSharing(DEFAULT_SHARE_SETTINGS);
    await flushAsyncWork();

    assert.equal(requestedConstraints?.audio, true);
    socket.receive({ type: "sharing-accepted", sharing: true, streamId });
    await sharing;
    assert.equal(publishedStream, displayStream);
    socket.receive({
      type: "stream-subscriber",
      peerId: "viewer",
      streamId,
      subscribed: true,
    });
    await flushAsyncWork();
    assert.equal(connections.length, 1);
    assert.deepEqual(
      connections[0]?.addedTracks.map(({ track, stream }) => [track.id, stream.id]),
      [
        ["display-video", "display-stream"],
        ["display-audio", "display-stream"],
      ],
    );
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});

test("keeps publishing independent from one focused incoming screen", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const connections: FakePeerConnection[] = [];
  const localTrack: MediaTrack = {
    id: "local-screen",
    kind: "video",
    enabled: true,
    stop: () => {},
    addEventListener: () => {},
  };
  const localStream: MediaStream = {
    id: "local-screen-stream",
    getTracks: () => [localTrack],
    getVideoTracks: () => [localTrack],
    getAudioTracks: () => [],
  };
  const remoteTrack: MediaTrack = {
    id: "remote-screen",
    kind: "video",
    enabled: true,
    stop: () => {},
    addEventListener: () => {},
  };
  const remoteStream: MediaStream = {
    id: "focused-remote-stream",
    getTracks: () => [remoteTrack],
    getVideoTracks: () => [remoteTrack],
    getAudioTracks: () => [],
  };
  const remoteStreamOne = "77777777-7777-4777-8777-777777777771";
  const remoteStreamTwo = "77777777-7777-4777-8777-777777777772";
  const localStreamId = "77777777-7777-4777-8777-777777777773";
  const remoteStreams = new Map<string, MediaStream | null>();

  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const adapter = {
    getDisplayMedia: async () => localStream,
    isCaptureRejected: () => false,
    serializeCandidate: (candidate) => candidate as IceCandidateInit,
    createPeerConnection: () => {
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
      onRemoteStream: (streamId, stream) => remoteStreams.set(streamId, stream),
      onConnectionState: () => {},
      onRemoteStats: () => {},
      onOutboundStats: () => {},
      onError: () => {},
    },
    { baseUrl: "https://signal.example.com", adapter },
  );

  try {
    session.start("room-id", "Viewer and sharer", "room-token");
    const socket = FakeSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "authenticated" });
    socket.receive({
      type: "room-state",
      selfId: "local-peer",
      peers: [
        {
          id: "remote-one",
          name: "Remote one",
          sharing: true,
          streamId: remoteStreamOne,
          voiceJoined: false,
          micMuted: true,
        },
        {
          id: "remote-two",
          name: "Remote two",
          sharing: true,
          streamId: remoteStreamTwo,
          voiceJoined: false,
          micMuted: true,
        },
      ],
    });

    session.focusPeer("remote-one");
    assert.ok(socket.sent.some((message) => (
      message.type === "subscribe" && message.streamId === remoteStreamOne
    )));
    socket.receive({
      type: "signal",
      from: "remote-one",
      channel: "screen",
      streamId: remoteStreamOne,
      data: { type: "offer", sdp: "remote-one-offer" },
    });
    await flushAsyncWork();
    assert.equal(connections.length, 1);

    const startSharing = session.startSharing(DEFAULT_SHARE_SETTINGS);
    await flushAsyncWork();
    socket.receive({ type: "sharing-accepted", sharing: true, streamId: localStreamId });
    await startSharing;
    socket.receive({
      type: "stream-subscriber",
      peerId: "local-viewer",
      streamId: localStreamId,
      subscribed: true,
    });
    await flushAsyncWork();

    assert.equal(connections.length, 2);
    assert.deepEqual(
      connections[1]?.addedTracks.map(({ track }) => track.id),
      [localTrack.id],
    );
    assert.ok(socket.sent.some((message) => (
      message.type === "signal"
      && message.channel === "screen"
      && message.streamId === localStreamId
      && message.target === "local-viewer"
      && (message.data as Record<string, unknown>).type === "offer"
    )));

    const screenCandidateConnections = [
      { connection: connections[0]!, target: "remote-one", streamId: remoteStreamOne },
      { connection: connections[1]!, target: "local-viewer", streamId: localStreamId },
    ];
    for (const { connection } of screenCandidateConnections) {
      for (let index = 0; index < 17; index += 1) {
        connection.onicecandidate?.({ candidate: { candidate: `candidate-${index}` } });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 550));

    for (const { target, streamId } of screenCandidateConnections) {
      const candidateBatches = socket.sent.filter((message) => {
        const data = message.data as { candidates?: unknown[] };
        return message.type === "signal"
          && message.channel === "screen"
          && message.target === target
          && message.streamId === streamId
          && Array.isArray(data.candidates);
      });
      assert.equal(candidateBatches.length, 3);
      assert.deepEqual(
        candidateBatches.flatMap((message) => (
          (message.data as { candidates: IceCandidateInit[] }).candidates
        )),
        Array.from({ length: 17 }, (_, index) => ({ candidate: `candidate-${index}` })),
      );
      assert.ok(candidateBatches.every((message) => (
        (message.data as { candidates: unknown[] }).candidates.length <= 8
      )));
    }

    session.focusPeer("remote-two");
    assert.equal(connections[0]?.connectionState, "closed");
    assert.equal(connections[1]?.connectionState, "new");
    assert.ok(socket.sent.some((message) => (
      message.type === "subscribe" && message.streamId === remoteStreamTwo
    )));

    socket.receive({
      type: "signal",
      from: "remote-one",
      channel: "screen",
      streamId: remoteStreamOne,
      data: { type: "offer", sdp: "stale-offer" },
    });
    await flushAsyncWork();
    assert.equal(connections.length, 2);

    socket.receive({
      type: "signal",
      from: "remote-two",
      channel: "screen",
      streamId: remoteStreamTwo,
      data: { type: "offer", sdp: "remote-two-offer" },
    });
    await flushAsyncWork();
    assert.equal(connections.length, 3);
    assert.equal(connections[1]?.connectionState, "new");
    assert.notEqual(connections[2]?.signalingState, "closed");

    connections[2]?.ontrack?.({ track: remoteTrack, streams: [remoteStream] });
    assert.equal(remoteStreams.get(remoteStreamTwo), remoteStream);

    session.stopSharing();
    assert.equal(connections[1]?.connectionState, "closed");
    assert.notEqual(connections[2]?.signalingState, "closed");

    session.focusPeer(null);
    assert.equal(connections[2]?.connectionState, "closed");
    assert.equal(remoteStreams.get(remoteStreamTwo), null);
  } finally {
    session.stop();
    globalThis.WebSocket = originalWebSocket;
    FakeSocket.instance = null;
  }
});
