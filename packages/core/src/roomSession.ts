import type {
  IceServer,
  MediaStream,
  OutboundVideoStats,
  Peer,
  PeerConnectionState,
  RemoteVideoStats,
  RTCPeerConnection,
  ServerMessage,
  ShareSettings,
  SignalData,
  SocketStatus,
  WebSocketLike,
} from "./types";
import { fallbackIceServers, getIceServers, websocketUrl } from "./signaling";
import {
  computeInboundVideoStats,
  computeOutboundVideoStats,
  configureVideoSender,
  getPeerMediaStats,
  logSelectedIceRoute,
  type InboundVideoSample,
  type OutboundVideoSample,
} from "./webrtc";
import type { PlatformAdapter } from "./adapter";

export type RoomSessionDeps = {
  baseUrl: string;
  adapter: PlatformAdapter;
};

export type RoomSessionCallbacks = {
  onStatus: (status: SocketStatus) => void;
  onPeers: (peers: Peer[]) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onIsStartingShare: (isStarting: boolean) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | null) => void;
  onConnectionState: (peerId: string, state: PeerConnectionState | null) => void;
  onRemoteStats: (peerId: string, stats: RemoteVideoStats | null) => void;
  onOutboundStats: (peerId: string, stats: OutboundVideoStats | null) => void;
  onError: (message: string) => void;
  onSessionRejected?: () => void;
  onSessionReplaced?: () => void;
};

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const CAPTURE_RECOVERY_MS = 30_000;
const ICE_DISCONNECTED_GRACE_MS = 5000;
const ICE_RESTART_COOLDOWN_MS = 10_000;
const OFFER_ANSWER_TIMEOUT_MS = 10_000;

/*
 * setTimeout/setInterval resolve to `number` in browsers and to a Timeout
 * object when @types/node is present. The four functions stay consistent
 * within a given environment, so a single handle type works everywhere.
 */
type TimerHandle = ReturnType<typeof setTimeout>;
type ShareRequestResult =
  | "accepted"
  | "rejected"
  | "disconnected"
  | "cancelled"
  | "timeout";

/*
 * Owns the entire WebSocket + WebRTC lifecycle for one room session.
 *
 * A single instance is created per useRoom() effect run and started with
 * start(). Because each effect run gets its own instance, the `active` flag
 * is equivalent to the per-effect `cancelled` closure: it can never be
 * re-enabled by a later StrictMode remount while this instance's async work
 * is still settling.
 */
export class RoomSession {
  private callbacks: RoomSessionCallbacks;
  private deps: RoomSessionDeps;

  private active = false;
  private terminal = false;
  private socket: WebSocketLike | null = null;
  private iceServers: IceServer[] = fallbackIceServers;

  private peers: Peer[] = [];
  private localStream: MediaStream | null = null;
  private disposedStreams = new WeakSet<MediaStream>();

  private shareSettings: ShareSettings | null = null;
  private scaleResolutionDownBy = 1;

  private peerConnections = new Map<string, RTCPeerConnection>();
  private pendingCandidates = new Map<string, unknown[]>();
  private pendingOffers = new Map<string, symbol>();
  private signalQueues = new Map<string, Promise<void>>();
  private peerGenerations = new Map<string, number>();

  private statsTimers = new Map<string, TimerHandle>();
  private inboundStatsSamples = new Map<string, InboundVideoSample>();
  private outboundStatsSamples = new Map<string, OutboundVideoSample>();
  private statsInFlight = new Map<string, RTCPeerConnection>();

  private reconnectTimer: TimerHandle | null = null;
  private reconnectAttempt = 0;
  private signalingGeneration = 0;
  private captureRecoveryTimer: TimerHandle | null = null;
  private iceRecoveryTimers = new Map<string, TimerHandle>();
  private lastIceRestartAt = new Map<string, number>();
  private offerAnswerTimers = new Map<string, TimerHandle>();

  private sharingRequest: ((result: ShareRequestResult) => void) | null = null;
  private startingShare = false;
  private sharingGeneration = 0;
  private restoringShare = false;
  private sharingAnnounced = false;
  private joined = false;

  private roomId = "";
  private name = "";
  private token = "";
  private authenticated = false;

  private heartbeatInterval: TimerHandle | null = null;

  constructor(callbacks: RoomSessionCallbacks, deps: RoomSessionDeps) {
    this.callbacks = callbacks;
    this.deps = deps;
  }

  start(roomId: string, name: string, token: string) {
    this.roomId = roomId;
    this.name = name;
    this.token = token;
    this.active = true;
    this.terminal = false;

    this.callbacks.onStatus("connecting");
    this.callbacks.onError("");

    void this.initialize();
  }

  stop() {
    this.active = false;
    this.authenticated = false;

    this.sharingGeneration += 1;

    this.sharingRequest?.("cancelled");
    this.sharingRequest = null;
    this.restoringShare = false;
    this.sharingAnnounced = false;
    this.joined = false;

    this.signalQueues.clear();

    for (const timer of this.statsTimers.values()) {
      clearInterval(timer);
    }

    this.clearPingTimer();
    this.clearReconnectTimer();
    this.clearCaptureRecoveryTimer();

    for (const timer of this.iceRecoveryTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of this.offerAnswerTimers.values()) {
      clearTimeout(timer);
    }

    this.statsTimers.clear();
    this.inboundStatsSamples.clear();
    this.outboundStatsSamples.clear();
    this.statsInFlight.clear();
    this.iceRecoveryTimers.clear();
    this.lastIceRestartAt.clear();
    this.offerAnswerTimers.clear();

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;

      this.socket.close();
      this.socket = null;
    }

    const stream = this.localStream;
    this.localStream = null;

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeer(peerId);
    }

    this.disposeCapturedStream(stream);

    this.pendingCandidates.clear();
    this.pendingOffers.clear();
    this.peerGenerations.clear();

    this.shareSettings = null;
    this.scaleResolutionDownBy = 1;

    this.peers = [];
  }

  resume() {
    if (!this.active || this.terminal) {
      return;
    }

    const socketState = this.socket?.readyState;

    if (socketState !== SOCKET_CONNECTING && socketState !== SOCKET_OPEN) {
      this.clearReconnectTimer();
      this.connectSocket();
      return;
    }

    for (const [peerId, connection] of this.peerConnections) {
      if (
        connection.connectionState === "disconnected" ||
        connection.connectionState === "failed"
      ) {
        this.clearIceRecoveryTimer(peerId);
        this.scheduleIceRecovery(peerId, 0);
      }
    }
  }

  async startSharing(settings: ShareSettings) {
    if (
      this.startingShare ||
      this.localStream ||
      this.peers.some((peer) => peer.sharing) ||
      this.socket?.readyState !== SOCKET_OPEN
    ) {
      return;
    }

    const generation = this.sharingGeneration + 1;
    this.sharingGeneration = generation;

    this.startingShare = true;

    this.callbacks.onIsStartingShare(true);
    this.callbacks.onError("");

    let stream: MediaStream | null = null;

    try {
      stream = await this.deps.adapter.getDisplayMedia({
        video: {
          width: {
            ideal: settings.width,
            max: settings.width,
          },
          height: {
            ideal: settings.height,
            max: settings.height,
          },
          frameRate: {
            ideal: settings.frameRate,
            max: settings.frameRate,
          },
        },
        audio: settings.includeAudio,
      });

      if (!this.active || generation !== this.sharingGeneration) {
        this.disposeCapturedStream(stream);
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];

      if (videoTrack) {
        if (videoTrack.applyConstraints) {
          try {
            await videoTrack.applyConstraints({
              width: {
                ideal: settings.width,
                max: settings.width,
              },
              height: {
                ideal: settings.height,
                max: settings.height,
              },
              frameRate: {
                ideal: settings.frameRate,
                max: settings.frameRate,
              },
            });
          } catch {
            /* Some platforms reject post-capture constraints; the sender encoding caps output anyway. */
          }
        }

        const trackSettings = videoTrack.getSettings?.();
        const trackWidth = trackSettings?.width;
        const trackHeight = trackSettings?.height;

        if (typeof trackWidth === "number" && typeof trackHeight === "number") {
          this.scaleResolutionDownBy = Math.max(
            1,
            trackWidth / settings.width,
            trackHeight / settings.height,
          );
        }
      }

      this.shareSettings = settings;

      /*
       * Ask signaling server whether we're
       * allowed to become this room's sharer.
       */
      const shareResult = await this.requestSharing();
      const accepted = shareResult === "accepted";

      if (shareResult === "timeout") {
        this.callbacks.onError(
          "The signaling server did not respond to the share request.",
        );
      }

      if (!accepted || !this.active || generation !== this.sharingGeneration) {
        this.disposeCapturedStream(stream);

        if (!accepted && this.active) {
          this.send({
            type: "sharing",
            sharing: false,
          });
        }

        return;
      }

      this.sharingAnnounced = true;

      this.localStream = stream;
      this.callbacks.onLocalStream(stream);

      /*
       * Platform's native "Stop sharing" control (browser button,
       * Android MediaProjection system UI).
       */
      stream
        .getVideoTracks()[0]
        ?.addEventListener(
          "ended",
          () => {
            this.stopSharing();
          },
          { once: true },
        );

      /*
       * Create one P2P connection for each
       * peer already in the room.
       */
      for (const peer of this.peers) {
        if (generation !== this.sharingGeneration) {
          break;
        }

        await this.createOffer(peer.id);
      }
    } catch (caught) {
      if (stream === this.localStream) {
        this.stopSharing();
      } else {
        this.disposeCapturedStream(stream);
      }

      if (this.deps.adapter.isCaptureRejected(caught)) {
        return;
      }

      console.error("Screen capture failed", caught);

      this.callbacks.onError("Screen capture could not be started.");
    } finally {
      if (generation === this.sharingGeneration) {
        this.startingShare = false;
        this.callbacks.onIsStartingShare(false);
      }
    }
  }

  stopSharing() {
    const stream = this.localStream;

    this.sharingGeneration += 1;

    this.sharingRequest?.("cancelled");
    this.sharingRequest = null;
    this.restoringShare = false;
    this.sharingAnnounced = false;
    this.clearCaptureRecoveryTimer();

    this.startingShare = false;

    this.callbacks.onIsStartingShare(false);

    this.localStream = null;
    this.callbacks.onLocalStream(null);

    this.shareSettings = null;
    this.scaleResolutionDownBy = 1;

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeer(peerId);
    }

    this.disposeCapturedStream(stream);

    if (stream) {
      this.send({
        type: "sharing",
        sharing: false,
      });
    }
  }

  /*
   * Initialization:
   *
   *   1. Get Cloudflare STUN/TURN credentials
   *   2. Only THEN connect to Fastify WebSocket
   *   3. Only THEN join the room
   *
   * This guarantees every RTCPeerConnection has TURN
   * available from the beginning.
   */
  private async initialize() {
    let resolvedIceServers: IceServer[];

    try {
      resolvedIceServers = await getIceServers(this.deps.baseUrl, this.token);
    } catch (caught) {
      console.warn(
        "Could not load TURN credentials. Falling back to STUN only.",
        caught,
      );

      resolvedIceServers = fallbackIceServers;
    }

    if (!this.active) {
      return;
    }

    this.iceServers = resolvedIceServers;
    this.connectSocket();
  }

  private connectSocket() {
    if (!this.active || this.terminal) {
      return;
    }

    const socketState = this.socket?.readyState;

    if (socketState === SOCKET_CONNECTING || socketState === SOCKET_OPEN) {
      return;
    }

    this.clearReconnectTimer();

    let ws: WebSocketLike;

    try {
      ws = this.createSocket();
    } catch (caught) {
      console.error("Could not create signaling WebSocket", caught);
      this.scheduleReconnect();
      return;
    }

    this.socket = ws;
    this.signalingGeneration += 1;
    this.authenticated = false;
    this.joined = false;

    ws.onopen = () => {
      if (!this.active || this.socket !== ws) {
        return;
      }

      console.log("Signaling WebSocket connected");

      /*
       * Authenticate with the room token first. The join
       * message is only accepted after authentication.
       */
      ws.send(
        JSON.stringify({
          type: "auth",
          token: this.token,
        }),
      );

      this.clearPingTimer();
      this.heartbeatInterval = setInterval(() => {
        if (ws.readyState !== SOCKET_OPEN) {
          return;
        }
    
        ws.send(
          JSON.stringify({
            type: "ping",
            timestamp: Date.now(),
          }),
        );
      }, 60_000);
    };

    ws.onmessage = (event) => {
      if (this.socket === ws) {
        this.handleSocketMessage(event);
      }
    };

    ws.onclose = (event) => {
      if (!this.active || this.socket !== ws) {
        return;
      }

      console.log("Signaling WebSocket disconnected");
      const wasAuthenticated = this.authenticated;

      this.socket = null;
      this.signalingGeneration += 1;
      this.authenticated = false;
      this.joined = false;
      this.sharingAnnounced = false;
      this.clearPingTimer();

      this.sharingRequest?.("disconnected");
      this.sharingRequest = null;
      this.signalQueues.clear();

      for (const peerId of Array.from(this.peerConnections.keys())) {
        this.closePeer(peerId);
      }

      this.peers = [];
      this.callbacks.onPeers([]);

      /*
       * The server closes with 1008 when the room token is
       * rejected (e.g. expired or signed with a different secret).
       */
      if (event.code === 1008) {
        this.terminal = true;
        this.callbacks.onStatus("disconnected");
        this.stopSharing();

        if (!wasAuthenticated) {
          this.callbacks.onSessionRejected?.();
        } else {
          this.callbacks.onError("The signaling server closed this session.");
        }

        return;
      }

      /*
       * The server closes with 4001 when the same session was
       * opened in another tab. The other tab is now the active
       * connection, so this one stops but keeps the stored session.
       */
      if (event.code === 4001) {
        this.terminal = true;
        this.callbacks.onStatus("disconnected");
        this.stopSharing();
        this.callbacks.onSessionReplaced?.();
        return;
      }

      this.callbacks.onStatus("reconnecting");
      this.startCaptureRecoveryTimer();
      this.scheduleReconnect();
    };

    ws.onerror = (event) => {
      console.error("Signaling WebSocket error", event);
    };
  }

  private scheduleReconnect() {
    if (!this.active || this.terminal || this.reconnectTimer) {
      return;
    }

    this.callbacks.onStatus("reconnecting");

    const baseDelay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    const delay = Math.min(
      Math.round(baseDelay * (0.8 + Math.random() * 0.4)),
      RECONNECT_MAX_MS,
    );

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket();
    }, delay);
  }

  private startCaptureRecoveryTimer() {
    if (!this.localStream || this.captureRecoveryTimer) {
      return;
    }

    this.captureRecoveryTimer = setTimeout(() => {
      this.captureRecoveryTimer = null;

      if (!this.localStream || this.sharingAnnounced) {
        return;
      }

      this.callbacks.onError(
        "Screen sharing stopped because the connection could not recover within 30 seconds.",
      );
      this.stopSharing();
    }, CAPTURE_RECOVERY_MS);
  }

  private requestSharing(): Promise<ShareRequestResult> {
    if (this.socket?.readyState !== SOCKET_OPEN || !this.joined) {
      return Promise.resolve("disconnected");
    }

    return new Promise((resolve) => {
      let settled = false;

      const finish = (result: ShareRequestResult) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (this.sharingRequest === finish) {
          this.sharingRequest = null;
        }

        resolve(result);
      };

      const timeout = setTimeout(() => finish("timeout"), 5000);

      this.sharingRequest?.("cancelled");
      this.sharingRequest = finish;

      this.send({
        type: "sharing",
        sharing: true,
      });
    });
  }

  private async restoreSharing() {
    if (
      !this.localStream ||
      this.restoringShare ||
      this.sharingAnnounced ||
      !this.joined
    ) {
      return;
    }

    const stream = this.localStream;
    const generation = this.sharingGeneration;

    this.restoringShare = true;

    try {
      const result = await this.requestSharing();

      if (
        !this.active ||
        generation !== this.sharingGeneration ||
        stream !== this.localStream
      ) {
        return;
      }

      if (result === "timeout") {
        console.warn("Sharing restoration timed out; reconnecting signaling");
        this.socket?.close();
        return;
      }

      if (result !== "accepted") {
        if (result === "rejected" && this.joined) {
          this.callbacks.onError(
            "Screen sharing could not be restored because another presenter is active.",
          );
          this.stopSharing();
        }

        return;
      }

      this.sharingAnnounced = true;
      this.clearCaptureRecoveryTimer();
      this.callbacks.onError("");

      for (const peer of this.peers) {
        if (
          generation !== this.sharingGeneration ||
          stream !== this.localStream
        ) {
          break;
        }
        

        await this.createOffer(peer.id);
      }
    } finally {
      this.restoringShare = false;
    }
  }

  private createSocket(): WebSocketLike {
    const Ctor = (
      globalThis as { WebSocket?: new (url: string) => WebSocketLike }
    ).WebSocket;

    if (!Ctor) {
      throw new Error("WebSocket is not available");
    }

    return new Ctor(websocketUrl(this.deps.baseUrl));
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(peerId);

    if (existing && existing.signalingState !== "closed") {
      return existing;
    }

    if (existing) {
      this.peerConnections.delete(peerId);
    }

    const connection = this.deps.adapter.createPeerConnection({
      iceServers: this.iceServers,
    });

    this.peerConnections.set(peerId, connection);

    this.callbacks.onConnectionState(peerId, connection.connectionState);

    /*
     * If we're already sharing when a peer joins,
     * attach the existing screen/audio tracks.
     */
    const localStream = this.localStream;

    if (localStream) {
      for (const track of localStream.getTracks()) {
        connection.addTrack(track, localStream);
      }
    }

    /*
     * Send ALL locally generated ICE candidates
     * through our signaling WebSocket.
     */
    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log(`[${peerId}] ICE candidate gathering finished`);
        return;
      }

      /*
       * Log the serialized form: react-native-webrtc's RTCIceCandidate
       * does not expose structured fields (address/port/protocol/type),
       * so the raw object would print undefined on Android.
       */
      console.log(
        `[${peerId}] ICE candidate`,
        this.deps.adapter.serializeCandidate(event.candidate),
      );

      this.send({
        type: "signal",
        target: peerId,
        data: {
          candidate: this.deps.adapter.serializeCandidate(event.candidate),
        },
      });
    };

    /*
     * ICE errors are diagnostic.
     *
     * For example, a 701 on IPv6 does NOT necessarily
     * mean the entire connection failed if IPv4 succeeds.
     */
    connection.onicecandidateerror = (event) => {
      const candidateError = event as {
        url?: string;
        address?: string;
        port?: number;
        errorCode?: number;
        errorText?: string;
      };

      console.warn(`[${peerId}] ICE candidate error`, {
        url: candidateError.url,
        address: candidateError.address,
        port: candidateError.port,
        errorCode: candidateError.errorCode,
        errorText: candidateError.errorText,
      });
    };

    connection.oniceconnectionstatechange = () => {
      console.log(`[${peerId}] ICE connection:`, connection.iceConnectionState);
    };

    connection.onicegatheringstatechange = () => {
      console.log(`[${peerId}] ICE gathering:`, connection.iceGatheringState);
    };

    connection.onsignalingstatechange = () => {
      console.log(`[${peerId}] Signaling:`, connection.signalingState);
    };

    /*
     * Remote screen/audio stream.
     */
    connection.ontrack = (event) => {
      const [stream] = event.streams;

      if (!stream) {
        console.warn(`[${peerId}] Track received without MediaStream`);
        return;
      }

      if (stream.getVideoTracks().length === 0) {
        return;
      }

      console.log(`[${peerId}] Remote stream received`, {
        streamId: stream.id,
        tracks: stream
          .getTracks()
          .map((track) => ({
            id: track.id,
            kind: track.kind,
            enabled: track.enabled,
            readyState: track.readyState,
          })),
      });

      this.callbacks.onRemoteStream(peerId, stream);
    };

    connection.onconnectionstatechange = () => {
      console.log(`[${peerId}] Connection:`, connection.connectionState);

      this.callbacks.onConnectionState(peerId, connection.connectionState);

      if (connection.connectionState === "connected") {
        this.clearIceRecoveryTimer(peerId);
        void logSelectedIceRoute(peerId, connection);
      }

      if (connection.connectionState === "disconnected") {
        this.scheduleIceRecovery(peerId, ICE_DISCONNECTED_GRACE_MS);
      }

      if (connection.connectionState === "closed") {
        this.closePeer(peerId);
      }

      if (connection.connectionState === "failed") {
        console.error(`[${peerId}] Peer connection failed`);
        this.clearIceRecoveryTimer(peerId);
        this.scheduleIceRecovery(peerId, 0);
      }
    };

    const timer = setInterval(() => {
      this.pollPeerStats(peerId, connection);
    }, 1000);

    this.statsTimers.set(peerId, timer);

    return connection;
  }

  /*
   * Apply the sharer's chosen quality (bitrate, fps, resolution
   * cap) to a connection's outbound video sender. Called before
   * createOffer() so the encoding caps are baked into the SDP.
   */
  private async applySenderSettings(connection: RTCPeerConnection) {
    const settings = this.shareSettings;

    if (!settings) {
      return;
    }

    const sender = connection
      .getSenders()
      .find((candidate) => candidate.track?.kind === "video");

    if (!sender) {
      return;
    }

    await configureVideoSender(sender, {
      maxBitrate: settings.maxBitrate,
      maxFramerate: settings.frameRate,
      scaleResolutionDownBy: this.scaleResolutionDownBy,
    });
  }

  /* Sample inbound and outbound video health for the debug overlays. */
  private pollPeerStats(peerId: string, connection: RTCPeerConnection) {
    if (!this.active || this.statsInFlight.has(peerId)) {
      return;
    }

    this.statsInFlight.set(peerId, connection);

    void (async () => {
      try {
        const { inbound, outbound, iceRoute } = await getPeerMediaStats(connection);

        if (
          !this.active ||
          this.peerConnections.get(peerId) !== connection ||
          this.statsInFlight.get(peerId) !== connection
        ) {
          return;
        }

        if (inbound) {
          const previous = this.inboundStatsSamples.get(peerId) ?? null;

          this.inboundStatsSamples.set(peerId, inbound);

          const stats = computeInboundVideoStats(inbound, previous);

          this.callbacks.onRemoteStats(peerId, {
            width: stats.width,
            height: stats.height,
            fps: stats.fps,
            bitrateKbps: stats.bitrateKbps ?? 0,
            codec: inbound.codecMimeType,
            route: iceRoute?.route ?? null,
            rttMs: iceRoute?.rtt != null ? iceRoute.rtt * 1000 : null,
            packetLossPercent: stats.packetLossPercent,
            jitterMs: inbound.jitter != null ? inbound.jitter * 1000 : null,
            framesDecoded: inbound.framesDecoded,
            framesDropped: inbound.framesDropped,
          });
        }

        if (outbound) {
          const previous = this.outboundStatsSamples.get(peerId) ?? null;

          this.outboundStatsSamples.set(peerId, outbound);

          const stats = computeOutboundVideoStats(outbound, previous);

          this.callbacks.onOutboundStats(peerId, {
            width: stats.width,
            height: stats.height,
            fps: stats.fps,
            bitrateKbps: stats.bitrateKbps ?? 0,
            codec: outbound.codecMimeType,
            route: iceRoute?.route ?? null,
            rttMs: iceRoute?.rtt != null ? iceRoute.rtt * 1000 : null,
            availableOutgoingBitrateKbps:
              iceRoute?.availableOutgoingBitrate != null
                ? iceRoute.availableOutgoingBitrate / 1000
                : null,
            qualityLimitationReason: outbound.qualityLimitationReason,
          });
        }
      } catch (caught) {
        console.warn(`[${peerId}] Could not read media stats`, caught);
      } finally {
        if (this.statsInFlight.get(peerId) === connection) {
          this.statsInFlight.delete(peerId);
        }
      }
    })();
  }

  /*
   * Candidates may arrive before the remote SDP.
   *
   * addIceCandidate() cannot safely be called until
   * remoteDescription exists.
   */
  private async addOrQueueCandidate(
    peerId: string,
    connection: RTCPeerConnection,
    candidate: unknown,
  ) {
    if (connection.signalingState === "closed") {
      return;
    }

    if (connection.remoteDescription) {
      try {
        await connection.addIceCandidate(candidate as never);
      } catch (caught) {
        console.error(`[${peerId}] addIceCandidate failed`, caught);
      }

      return;
    }

    const pending = this.pendingCandidates.get(peerId) ?? [];

    pending.push(candidate);

    this.pendingCandidates.set(peerId, pending);
  }

  private async flushCandidates(peerId: string, connection: RTCPeerConnection) {
    const pending = this.pendingCandidates.get(peerId) ?? [];

    this.pendingCandidates.delete(peerId);

    for (const candidate of pending) {
      if (connection.signalingState === "closed") {
        return;
      }

      try {
        await connection.addIceCandidate(candidate as never);
      } catch (caught) {
        console.error(`[${peerId}] Queued addIceCandidate failed`, caught);
      }
    }
  }

  /*
   * The screen sharer creates an offer for each peer.
   */
  private async createOffer(peerId: string, iceRestart = false) {
    if (this.pendingOffers.has(peerId) || !this.localStream) {
      return;
    }

    const generation = this.sharingGeneration;
    const offerToken = Symbol(peerId);
    let connection: RTCPeerConnection | null = null;

    this.pendingOffers.set(peerId, offerToken);

    try {
      connection = this.createPeerConnection(peerId);

      /*
       * We should only create a fresh offer while stable.
       */
      if (connection.signalingState !== "stable") {
        console.warn(
          `[${peerId}] Cannot create offer in signaling state`,
          connection.signalingState,
        );

        return;
      }

      await this.applySenderSettings(connection);

      try {
        await this.deps.adapter.configureVideoCodecs?.(connection);
      } catch (caught) {
        console.warn(`[${peerId}] Could not configure video codecs`, caught);
      }

      const offer = await connection.createOffer(
        iceRestart ? { iceRestart: true } : undefined,
      );

      if (
        !this.active ||
        !this.joined ||
        !this.sharingAnnounced ||
        generation !== this.sharingGeneration ||
        !this.localStream ||
        this.peerConnections.get(peerId) !== connection
      ) {
        return;
      }

      await connection.setLocalDescription(offer);

      if (
        !this.active ||
        !this.joined ||
        !this.sharingAnnounced ||
        generation !== this.sharingGeneration ||
        !this.localStream ||
        this.peerConnections.get(peerId) !== connection
      ) {
        return;
      }

      console.log(
        `[${peerId}] Sending ${iceRestart ? "ICE restart " : ""}offer`,
      );

      this.send({
        type: "signal",
        target: peerId,
        data: connection.localDescription,
      });
      this.startOfferAnswerTimer(peerId, connection);
    } catch (caught) {
      console.error(`[${peerId}] Could not create offer`, caught);

      if (
        this.active &&
        this.joined &&
        generation === this.sharingGeneration &&
        connection &&
        this.peerConnections.get(peerId) === connection
      ) {
        this.callbacks.onError("Could not start a peer connection.");
      }

      if (connection && this.peerConnections.get(peerId) === connection) {
        this.closePeer(peerId);

        if (
          this.joined &&
          this.sharingAnnounced &&
          this.localStream &&
          this.peers.some((peer) => peer.id === peerId)
        ) {
          this.scheduleIceRecovery(
            peerId,
            ICE_RESTART_COOLDOWN_MS,
            true,
          );
        }
      }
    } finally {
      if (this.pendingOffers.get(peerId) === offerToken) {
        this.pendingOffers.delete(peerId);
      }
    }
  }

  /*
   * Actually process ONE signaling message.
   *
   * These calls will be serialized per peer by
   * enqueueSignal() below.
   */
  private async processSignal(
    from: string,
    data: SignalData,
    signalingGeneration: number,
    peerGeneration: number,
  ) {
    if (
      !this.active ||
      !this.joined ||
      signalingGeneration !== this.signalingGeneration ||
      peerGeneration !== (this.peerGenerations.get(from) ?? 0)
    ) {
      return;
    }

    if ("restartRequest" in data) {
      if (this.localStream && this.sharingAnnounced) {
        this.scheduleIceRecovery(from, 0, true);
      }

      return;
    }

    const connection = this.createPeerConnection(from);

    /*
     * ICE candidate
     */
    if ("candidate" in data) {
      await this.addOrQueueCandidate(from, connection, data.candidate);
      return;
    }

    /*
     * SDP ANSWER
     *
     * An answer is only valid if we previously created
     * an offer and are currently waiting for its answer.
     */
    if (data.type === "answer") {
      if (connection.signalingState !== "have-local-offer") {
        console.warn(`[${from}] Ignoring stale/duplicate answer`, {
          signalingState: connection.signalingState,
        });

        return;
      }

      console.log(`[${from}] Applying answer`);

      await connection.setRemoteDescription(data);

      if (
        this.peerConnections.get(from) !== connection ||
        !this.joined ||
        peerGeneration !== (this.peerGenerations.get(from) ?? 0)
      ) {
        return;
      }

      this.clearOfferAnswerTimer(from);

      await this.flushCandidates(from, connection);

      return;
    }

    /*
     * SDP OFFER
     *
     * In our architecture the screen sharer creates offers
     * and viewers normally answer them.
     */
    if (data.type === "offer") {
      if (connection.signalingState !== "stable") {
        console.warn(`[${from}] Ignoring offer in unexpected state`, {
          signalingState: connection.signalingState,
        });

        return;
      }

      console.log(`[${from}] Applying offer`);

      await connection.setRemoteDescription(data);

      if (this.peerConnections.get(from) !== connection || !this.joined) {
        return;
      }

      await this.flushCandidates(from, connection);

      if (this.peerConnections.get(from) !== connection || !this.joined) {
        return;
      }

      const answer = await connection.createAnswer();

      if (this.peerConnections.get(from) !== connection || !this.joined) {
        return;
      }

      await connection.setLocalDescription(answer);

      if (this.peerConnections.get(from) !== connection || !this.joined) {
        return;
      }

      console.log(`[${from}] Sending answer`);

      this.send({
        type: "signal",
        target: from,
        data: connection.localDescription,
      });
    }
  }

  /*
   * Serialize signaling operations for EACH peer.
   *
   * This is critical.
   *
   * Before:
   *
   *   void handleSignal(message1)
   *   void handleSignal(message2)
   *
   * Both could manipulate the same RTCPeerConnection
   * simultaneously.
   *
   * Now:
   *
   *   message1
   *      ↓ await
   *   message2
   *      ↓ await
   *   message3
   */
  private enqueueSignal(
    from: string,
    data: SignalData,
    signalingGeneration: number,
  ) {
    const peerGeneration = this.peerGenerations.get(from) ?? 0;
    const previous = this.signalQueues.get(from) ?? Promise.resolve();

    const next = previous
      .catch(() => {
        /*
         * Don't permanently break the queue if an
         * earlier message failed.
         */
      })
      .then(async () => {
        if (
          !this.active ||
          !this.joined ||
          signalingGeneration !== this.signalingGeneration ||
          peerGeneration !== (this.peerGenerations.get(from) ?? 0)
        ) {
          return;
        }

        try {
          await this.processSignal(
            from,
            data,
            signalingGeneration,
            peerGeneration,
          );
        } catch (caught) {
          console.error(`[${from}] WebRTC negotiation failed`, caught);

          if (this.active && this.joined) {
            this.callbacks.onError(
              "WebRTC negotiation failed. Try rejoining the room.",
            );
          }
        }
      });

    this.signalQueues.set(from, next);

    void next.finally(() => {
      if (this.signalQueues.get(from) === next) {
        this.signalQueues.delete(from);
      }
    });
  }

  /*
   * WebSocket messages from Fastify.
   */
  private handleSocketMessage = (event: { data: unknown }) => {
    if (!this.active) {
      return;
    }

    let message: ServerMessage;

    try {
      message = JSON.parse(event.data as string) as ServerMessage;
    } catch (caught) {
      console.warn("Ignoring invalid signaling message", caught);
      return;
    }

    if (message.type === "authenticated") {
      this.authenticated = true;

      this.send({
        type: "join",
        room: this.roomId,
        name: this.name,
      });

      return;
    }

    if (message.type === "room-state") {
      this.joined = true;
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();

      this.peers = message.peers;
      this.callbacks.onPeers(message.peers);
      this.callbacks.onStatus("connected");

      if (this.localStream) {
        void this.restoreSharing();
      }

      return;
    }

    if (message.type === "peer-joined") {
      this.signalQueues.delete(message.peer.id);
      this.closePeer(message.peer.id);

      this.peers = [
        ...this.peers.filter((peer) => peer.id !== message.peer.id),
        message.peer,
      ];

      this.callbacks.onPeers(this.peers);

      /*
       * If we're currently sharing, the new viewer
       * immediately gets an offer.
       */
      if (this.localStream && this.sharingAnnounced) {
        void this.createOffer(message.peer.id);
      }

      return;
    }

    if (message.type === "peer-left") {
      this.signalQueues.delete(message.peerId);

      this.closePeer(message.peerId);

      this.peers = this.peers.filter((peer) => peer.id !== message.peerId);

      this.callbacks.onPeers(this.peers);

      return;
    }

    if (message.type === "peer-updated") {
      this.peers = this.peers.map((peer) =>
        peer.id === message.peer.id ? message.peer : peer,
      );

      this.callbacks.onPeers(this.peers);

      if (!message.peer.sharing) {
        this.signalQueues.delete(message.peer.id);
        this.closePeer(message.peer.id);
      }

      return;
    }

    if (message.type === "signal") {
      this.enqueueSignal(
        message.from,
        message.data,
        this.signalingGeneration,
      );
      return;
    }

    if (message.type === "sharing-accepted") {
      this.sharingRequest?.(message.sharing ? "accepted" : "rejected");

      return;
    }

    if (message.type === "error") {
      this.callbacks.onError(message.message);

      if (message.code === "SHARER_EXISTS") {
        this.sharingRequest?.("rejected");
      }
    }
  };

  private scheduleIceRecovery(peerId: string, delay: number, force = false) {
    if (force) {
      this.clearIceRecoveryTimer(peerId);
    }

    if (!this.active || this.iceRecoveryTimers.has(peerId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.iceRecoveryTimers.delete(peerId);

      if (
        this.socket?.readyState !== SOCKET_OPEN ||
        !this.joined ||
        !this.peers.some((peer) => peer.id === peerId)
      ) {
        return;
      }

      const connection = this.peerConnections.get(peerId);

      if (
        connection &&
        !force &&
        connection.connectionState !== "disconnected" &&
        connection.connectionState !== "failed"
      ) {
        return;
      }

      if (
        !connection &&
        (!force || !this.localStream || !this.sharingAnnounced)
      ) {
        return;
      }

      const elapsed = Date.now() - (this.lastIceRestartAt.get(peerId) ?? 0);

      if (elapsed < ICE_RESTART_COOLDOWN_MS) {
        this.scheduleIceRecovery(
          peerId,
          ICE_RESTART_COOLDOWN_MS - elapsed,
          force,
        );
        return;
      }

      this.lastIceRestartAt.set(peerId, Date.now());

      if (this.localStream) {
        if (!this.sharingAnnounced) {
          return;
        }

        void this.createOffer(
          peerId,
          Boolean(connection && connection.signalingState !== "closed"),
        );
      } else {
        this.send({
          type: "signal",
          target: peerId,
          data: { restartRequest: true },
        });
      }

      this.scheduleIceRecovery(peerId, ICE_RESTART_COOLDOWN_MS);
    }, delay);

    this.iceRecoveryTimers.set(peerId, timer);
  }

  private clearIceRecoveryTimer(peerId: string) {
    const timer = this.iceRecoveryTimers.get(peerId);

    if (timer) {
      clearTimeout(timer);
      this.iceRecoveryTimers.delete(peerId);
    }
  }

  private startOfferAnswerTimer(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    this.clearOfferAnswerTimer(peerId);

    const timer = setTimeout(() => {
      this.offerAnswerTimers.delete(peerId);

      if (
        this.peerConnections.get(peerId) !== connection ||
        connection.signalingState !== "have-local-offer"
      ) {
        return;
      }

      console.warn(`[${peerId}] Offer timed out; rebuilding peer connection`);
      this.closePeer(peerId);

      if (
        this.localStream &&
        this.sharingAnnounced &&
        this.peers.some((peer) => peer.id === peerId)
      ) {
        this.scheduleIceRecovery(peerId, 0, true);
      }
    }, OFFER_ANSWER_TIMEOUT_MS);

    this.offerAnswerTimers.set(peerId, timer);
  }

  private clearOfferAnswerTimer(peerId: string) {
    const timer = this.offerAnswerTimers.get(peerId);

    if (timer) {
      clearTimeout(timer);
      this.offerAnswerTimers.delete(peerId);
    }
  }

  private clearPingTimer() {
    const timer = this.heartbeatInterval

    if (timer != null) {
      clearInterval(timer);
      this.heartbeatInterval = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearCaptureRecoveryTimer() {
    if (this.captureRecoveryTimer) {
      clearTimeout(this.captureRecoveryTimer);
      this.captureRecoveryTimer = null;
    }
  }

  private disposeCapturedStream(stream: MediaStream | null) {
    if (!stream || this.disposedStreams.has(stream)) {
      return;
    }

    this.disposedStreams.add(stream);

    try {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    } finally {
      this.deps.adapter.releaseMediaStream?.(stream);
    }
  }

  private closePeer(peerId: string) {
    this.peerGenerations.set(
      peerId,
      (this.peerGenerations.get(peerId) ?? 0) + 1,
    );

    const connection = this.peerConnections.get(peerId);

    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onicecandidateerror = null;
      connection.oniceconnectionstatechange = null;
      connection.onicegatheringstatechange = null;
      connection.onconnectionstatechange = null;

      connection.close();

      this.peerConnections.delete(peerId);
    }

    this.pendingCandidates.delete(peerId);
    this.pendingOffers.delete(peerId);
    this.clearIceRecoveryTimer(peerId);
    this.clearOfferAnswerTimer(peerId);
    this.lastIceRestartAt.delete(peerId);

    const timer = this.statsTimers.get(peerId);

    if (timer) {
      clearInterval(timer);
      this.statsTimers.delete(peerId);
    }

    this.inboundStatsSamples.delete(peerId);
    this.outboundStatsSamples.delete(peerId);
    this.statsInFlight.delete(peerId);

    this.callbacks.onRemoteStream(peerId, null);
    this.callbacks.onConnectionState(peerId, null);
    this.callbacks.onRemoteStats(peerId, null);
    this.callbacks.onOutboundStats(peerId, null);
  }

  private send(message: unknown) {
    if (this.socket?.readyState !== SOCKET_OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}
