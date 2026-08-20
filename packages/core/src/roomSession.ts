import type {
  IceServer,
  MediaStream,
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
  configureVideoSender,
  getPeerMediaStats,
  logSelectedIceRoute,
  type InboundVideoSample,
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
  onError: (message: string) => void;
  onSessionRejected?: () => void;
  onSessionReplaced?: () => void;
};

const SOCKET_OPEN = 1;

/*
 * setTimeout/setInterval resolve to `number` in browsers and to a Timeout
 * object when @types/node is present. The four functions stay consistent
 * within a given environment, so a single handle type works everywhere.
 */
type TimerHandle = ReturnType<typeof setTimeout>;

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
  private socket: WebSocketLike | null = null;
  private iceServers: IceServer[] = fallbackIceServers;

  private peers: Peer[] = [];
  private localStream: MediaStream | null = null;

  private shareSettings: ShareSettings | null = null;
  private scaleResolutionDownBy = 1;

  private peerConnections = new Map<string, RTCPeerConnection>();
  private pendingCandidates = new Map<string, unknown[]>();
  private pendingOffers = new Set<string>();
  private signalQueues = new Map<string, Promise<void>>();

  private statsTimers = new Map<string, TimerHandle>();
  private statsSamples = new Map<string, InboundVideoSample | null>();

  private sharingRequest: ((accepted: boolean) => void) | null = null;
  private startingShare = false;
  private sharingGeneration = 0;

  private roomId = "";
  private name = "";
  private token = "";
  private authenticated = false;

  constructor(callbacks: RoomSessionCallbacks, deps: RoomSessionDeps) {
    this.callbacks = callbacks;
    this.deps = deps;
  }

  start(roomId: string, name: string, token: string) {
    this.roomId = roomId;
    this.name = name;
    this.token = token;
    this.active = true;

    this.callbacks.onStatus("connecting");
    this.callbacks.onError("");

    void this.initialize();
  }

  stop() {
    this.active = false;
    this.authenticated = false;

    this.sharingGeneration += 1;

    this.sharingRequest?.(false);
    this.sharingRequest = null;

    this.signalQueues.clear();

    for (const timer of this.statsTimers.values()) {
      clearInterval(timer);
    }

    this.statsTimers.clear();
    this.statsSamples.clear();

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;

      this.socket.close();
      this.socket = null;
    }

    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = null;

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeer(peerId);
    }

    this.pendingCandidates.clear();
    this.pendingOffers.clear();

    this.shareSettings = null;
    this.scaleResolutionDownBy = 1;

    this.peers = [];
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
        audio: true,
      });

      if (!this.active || generation !== this.sharingGeneration) {
        for (const track of stream.getTracks()) {
          track.stop();
        }

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
      const accepted = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          this.sharingRequest = null;

          this.callbacks.onError(
            "The signaling server did not respond to the share request.",
          );

          resolve(false);
        }, 5000);

        this.sharingRequest = (granted) => {
          clearTimeout(timeout);
          resolve(granted);
        };

        this.send({
          type: "sharing",
          sharing: true,
        });
      });

      if (!accepted || !this.active || generation !== this.sharingGeneration) {
        for (const track of stream.getTracks()) {
          track.stop();
        }

        if (!accepted && this.active) {
          this.send({
            type: "sharing",
            sharing: false,
          });
        }

        return;
      }

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
      if (this.deps.adapter.isCaptureRejected(caught)) {
        return;
      }

      console.error("Screen capture failed", caught);

      this.callbacks.onError("Screen capture could not be started.");

      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
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

    this.sharingRequest?.(false);
    this.sharingRequest = null;

    this.startingShare = false;

    this.callbacks.onIsStartingShare(false);

    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = null;
    this.callbacks.onLocalStream(null);

    this.shareSettings = null;
    this.scaleResolutionDownBy = 1;

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeer(peerId);
    }

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

    const ws = this.createSocket();

    if (!this.active) {
      ws.close();
      return;
    }

    this.socket = ws;

    ws.onopen = () => {
      if (!this.active) {
        return;
      }

      console.log("Signaling WebSocket connected");

      this.callbacks.onStatus("connected");

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
    };

    ws.onmessage = this.handleSocketMessage;

    ws.onclose = (event) => {
      if (!this.active) {
        return;
      }

      console.log("Signaling WebSocket disconnected");

      this.callbacks.onStatus("disconnected");

      /*
       * The server closes with 1008 when the room token is
       * rejected (e.g. expired or signed with a different secret).
       */
      if (event.code === 1008 && !this.authenticated) {
        this.callbacks.onSessionRejected?.();
        return;
      }

      /*
       * The server closes with 4001 when the same session was
       * opened in another tab. The other tab is now the active
       * connection, so this one stops but keeps the stored session.
       */
      if (event.code === 4001) {
        this.stopSharing();
        this.callbacks.onSessionReplaced?.();
        return;
      }

      this.stopSharing();
    };

    ws.onerror = (event) => {
      console.error("Signaling WebSocket error", event);

      if (!this.active) {
        return;
      }

      this.callbacks.onError("Could not reach the signaling server.");
    };
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
        void logSelectedIceRoute(peerId, connection);
      }

      if (connection.connectionState === "closed") {
        this.closePeer(peerId);
      }

      if (connection.connectionState === "failed") {
        console.error(`[${peerId}] Peer connection failed`);
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

  /*
   * Sample inbound video stats for the receiver-quality badge.
   */
  private pollPeerStats(peerId: string, connection: RTCPeerConnection) {
    if (!this.active) {
      return;
    }

    void (async () => {
      try {
        const { inbound, iceRoute } = await getPeerMediaStats(connection);

        if (!inbound) {
          this.statsSamples.delete(peerId);
          this.callbacks.onRemoteStats(peerId, null);
          return;
        }

        const previous = this.statsSamples.get(peerId) ?? null;

        this.statsSamples.set(peerId, inbound);

        const stats = computeInboundVideoStats(inbound, previous);

        if (stats.width && stats.height && stats.fps) {
          this.callbacks.onRemoteStats(peerId, {
            width: stats.width,
            height: stats.height,
            fps: stats.fps,
            bitrateKbps: stats.bitrateKbps ?? 0,
            codec: inbound.codecMimeType,
            route: iceRoute?.route ?? null,
          });
        } else {
          this.callbacks.onRemoteStats(peerId, null);
        }
      } catch (caught) {
        console.warn(`[${peerId}] Could not read receive stats`, caught);
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
  private async createOffer(peerId: string) {
    if (this.pendingOffers.has(peerId) || !this.localStream) {
      return;
    }

    const generation = this.sharingGeneration;

    this.pendingOffers.add(peerId);

    try {
      const connection = this.createPeerConnection(peerId);

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

      let offer = await connection.createOffer();

      if (!this.active || generation !== this.sharingGeneration || !this.localStream) {
        return;
      }

      const munge = this.deps.adapter.mungeOffer;

      if (munge && offer.sdp) {
        offer = { ...offer, sdp: munge(offer.sdp) };
      }

      await connection.setLocalDescription(offer);

      if (!this.active || generation !== this.sharingGeneration || !this.localStream) {
        return;
      }

      console.log(`[${peerId}] Sending offer`);

      this.send({
        type: "signal",
        target: peerId,
        data: connection.localDescription,
      });
    } catch (caught) {
      console.error(`[${peerId}] Could not create offer`, caught);

      if (this.active && generation === this.sharingGeneration) {
        this.callbacks.onError("Could not start a peer connection.");
      }

      this.closePeer(peerId);
    } finally {
      this.pendingOffers.delete(peerId);
    }
  }

  /*
   * Actually process ONE signaling message.
   *
   * These calls will be serialized per peer by
   * enqueueSignal() below.
   */
  private async processSignal(from: string, data: SignalData) {
    if (!this.active) {
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

      await this.flushCandidates(from, connection);

      const answer = await connection.createAnswer();

      await connection.setLocalDescription(answer);

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
  private enqueueSignal(from: string, data: SignalData) {
    const previous = this.signalQueues.get(from) ?? Promise.resolve();

    const next = previous
      .catch(() => {
        /*
         * Don't permanently break the queue if an
         * earlier message failed.
         */
      })
      .then(async () => {
        if (!this.active) {
          return;
        }

        try {
          await this.processSignal(from, data);
        } catch (caught) {
          console.error(`[${from}] WebRTC negotiation failed`, caught);

          if (this.active) {
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
      this.peers = message.peers;
      this.callbacks.onPeers(message.peers);

      return;
    }

    if (message.type === "peer-joined") {
      this.peers = [
        ...this.peers.filter((peer) => peer.id !== message.peer.id),
        message.peer,
      ];

      this.callbacks.onPeers(this.peers);

      /*
       * If we're currently sharing, the new viewer
       * immediately gets an offer.
       */
      if (this.localStream) {
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
      this.enqueueSignal(message.from, message.data);
      return;
    }

    if (message.type === "sharing-accepted") {
      this.sharingRequest?.(message.sharing);
      this.sharingRequest = null;

      return;
    }

    if (message.type === "error") {
      this.callbacks.onError(message.message);

      if (message.code === "SHARER_EXISTS") {
        this.sharingRequest?.(false);
        this.sharingRequest = null;
      }
    }
  };

  private closePeer(peerId: string) {
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

    const timer = this.statsTimers.get(peerId);

    if (timer) {
      clearInterval(timer);
      this.statsTimers.delete(peerId);
    }

    this.statsSamples.delete(peerId);

    this.callbacks.onRemoteStream(peerId, null);
    this.callbacks.onConnectionState(peerId, null);
    this.callbacks.onRemoteStats(peerId, null);
  }

  private send(message: unknown) {
    if (this.socket?.readyState !== SOCKET_OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}