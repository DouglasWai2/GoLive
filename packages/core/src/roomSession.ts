import type {
  IceServer,
  MediaStream,
  MediaTrack,
  OutboundVideoStats,
  Peer,
  PeerConnectionState,
  RemoteVideoStats,
  RTCPeerConnection,
  RTCRtpSender,
  ServerMessage,
  ShareSettings,
  SignalData,
  SocketStatus,
  VoiceState,
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
  onPeerJoined?: (peer: Peer) => void;
  onPeerLeft?: (peer: Peer) => void;
  onPeerSharingChanged?: (peer: Peer) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onIsStartingShare: (isStarting: boolean) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | null) => void;
  onConnectionState: (peerId: string, state: PeerConnectionState | null) => void;
  onRemoteStats: (peerId: string, stats: RemoteVideoStats | null) => void;
  onOutboundStats: (peerId: string, stats: OutboundVideoStats | null) => void;
  onVoiceState?: (state: VoiceState) => void;
  onRemoteVoiceTrack?: (peerId: string, track: MediaTrack | null) => void;
  onError: (message: string) => void;
  onSessionRejected?: () => void;
  onSessionReplaced?: () => void;
};

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SESSION_REJECTED_CODE = 4003;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const CAPTURE_RECOVERY_MS = 30_000;
const ICE_DISCONNECTED_GRACE_MS = 5000;
const ICE_RESTART_COOLDOWN_MS = 10_000;
const OFFER_ANSWER_TIMEOUT_MS = 10_000;
const RELAY_FAILURE_GRACE_MS = 15_000;
const TURN_FETCH_RETRY_MS = 30_000;
const STREAM_UNAVAILABLE_MESSAGE =
  "Unable to start stream right now. Try again later.";

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
  private turnServersPromise: Promise<IceServer[]> | null = null;
  private turnConnections = new WeakSet<RTCPeerConnection>();
  private turnUpgrades = new Set<string>();
  private turnFailedPeers = new Set<string>();
  private pendingRestartRequests = new Set<string>();
  private turnFetchFailures = new Map<string, number>();
  private turnRetryTimers = new Map<string, TimerHandle>();
  private relayRecoveryAttempts = new Set<string>();
  private relayFailureTimers = new Map<string, TimerHandle>();

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

  private voiceDesired = false;
  private voiceJoined = false;
  private micMuted = true;
  private requestingMicrophone = false;
  private microphoneGeneration = 0;
  private microphoneStream: MediaStream | null = null;
  private voicePeerConnections = new Map<string, RTCPeerConnection>();
  private voiceSenders = new Map<string, RTCRtpSender>();
  private voicePendingCandidates = new Map<string, unknown[]>();
  private voicePendingOffers = new Map<string, symbol>();
  private voiceSignalQueues = new Map<string, Promise<void>>();
  private voicePeerGenerations = new Map<string, number>();
  private voiceRecoveryTimers = new Map<string, TimerHandle>();
  private voiceOfferAnswerTimers = new Map<string, TimerHandle>();
  private voiceRetryTimers = new Map<string, TimerHandle>();

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
  private selfId = "";
  private isHost = false;
  private heartbeatOwnerId = "";
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

    this.connectSocket();
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
    this.voiceSignalQueues.clear();

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

    for (const timer of this.relayFailureTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of this.turnRetryTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of this.voiceRecoveryTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of this.voiceOfferAnswerTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of this.voiceRetryTimers.values()) {
      clearTimeout(timer);
    }

    this.statsTimers.clear();
    this.inboundStatsSamples.clear();
    this.outboundStatsSamples.clear();
    this.statsInFlight.clear();
    this.iceRecoveryTimers.clear();
    this.lastIceRestartAt.clear();
    this.offerAnswerTimers.clear();
    this.relayFailureTimers.clear();
    this.turnUpgrades.clear();
    this.turnFailedPeers.clear();
    this.relayRecoveryAttempts.clear();
    this.pendingRestartRequests.clear();
    this.turnFetchFailures.clear();
    this.turnRetryTimers.clear();
    this.voiceRecoveryTimers.clear();
    this.voiceOfferAnswerTimers.clear();
    this.voiceRetryTimers.clear();

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
    const microphoneStream = this.microphoneStream;
    this.microphoneStream = null;

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeer(peerId);
    }

    for (const peerId of Array.from(this.voicePeerConnections.keys())) {
      this.closeVoicePeer(peerId);
    }

    this.disposeCapturedStream(stream);
    this.disposeCapturedStream(microphoneStream);

    this.pendingCandidates.clear();
    this.pendingOffers.clear();
    this.peerGenerations.clear();
    this.voicePendingCandidates.clear();
    this.voicePendingOffers.clear();
    this.voicePeerGenerations.clear();

    this.shareSettings = null;
    this.scaleResolutionDownBy = 1;

    this.peers = [];
    this.selfId = "";
    this.isHost = false;
    this.heartbeatOwnerId = "";
    this.voiceDesired = false;
    this.voiceJoined = false;
    this.micMuted = true;
    this.requestingMicrophone = false;
    this.microphoneGeneration += 1;
    this.emitVoiceState();
  }

  resume() {
    if (!this.active || this.terminal) {
      return;
    }

    const socketState = this.socket?.readyState;

    if (socketState === SOCKET_OPEN && this.joined && this.isHost) {
      this.send({ type: "heartbeat-reclaim" });
    }

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

    for (const [peerId, connection] of this.voicePeerConnections) {
      if (
        connection.connectionState === "disconnected" ||
        connection.connectionState === "failed"
      ) {
        this.scheduleVoiceRecovery(peerId, connection);
      }
    }
  }

  joinVoice() {
    this.voiceDesired = true;
    this.emitVoiceState();

    if (this.joined) {
      this.announceVoiceState();
      void this.ensureTurnServers().catch((caught) => {
        console.warn("TURN is unavailable for room voice", caught);
      });
    }
  }

  leaveVoice() {
    this.voiceDesired = false;
    this.voiceJoined = false;
    this.micMuted = true;
    this.requestingMicrophone = false;
    this.microphoneGeneration += 1;

    const stream = this.microphoneStream;
    this.microphoneStream = null;
    this.disposeCapturedStream(stream);

    for (const peerId of Array.from(this.voicePeerConnections.keys())) {
      this.closeVoicePeer(peerId);
    }

    this.send({ type: "voice", joined: false, micMuted: true });
    this.emitVoiceState();
  }

  handleAppBackground() {
    // MediaProjection backgrounds the activity while its consent UI is shown and
    // while the user views another app. Keep voice active during screen sharing.
    if (this.startingShare || this.localStream) return;
    void this.setMicrophoneMuted(true);
  }

  async setMicrophoneMuted(muted: boolean) {
    if (!this.voiceDesired || this.requestingMicrophone) return;

    if (!muted && !this.microphoneStream) {
      const getUserMedia = this.deps.adapter.getUserMedia;
      if (!getUserMedia) {
        this.callbacks.onError("Microphone voice chat is not supported on this device.");
        return;
      }

      this.requestingMicrophone = true;
      const microphoneGeneration = this.microphoneGeneration + 1;
      this.microphoneGeneration = microphoneGeneration;
      this.emitVoiceState();

      let requestedStream: MediaStream | null = null;

      try {
        requestedStream = await getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (
          !this.active
          || !this.voiceDesired
          || microphoneGeneration !== this.microphoneGeneration
        ) {
          this.disposeCapturedStream(requestedStream);
          return;
        }

        const track = requestedStream.getAudioTracks()[0];
        if (!track) {
          this.disposeCapturedStream(requestedStream);
          throw new Error("No microphone track was returned");
        }

        const activeStream = requestedStream;
        const detachMicrophone = () => {
          track.enabled = false;
          if (this.microphoneStream === activeStream) {
            this.microphoneStream = null;
          }
          this.disposeCapturedStream(activeStream);
          void Promise.allSettled(
            [...this.voiceSenders.values()].map((sender) =>
              sender.replaceTrack?.(null) ?? Promise.resolve(),
            ),
          );
        };

        track.enabled = false;
        this.microphoneStream = activeStream;
        track.addEventListener("ended", () => {
          if (this.microphoneStream !== activeStream) return;

          this.microphoneGeneration += 1;
          this.microphoneStream = null;
          this.micMuted = true;
          this.announceVoiceState();
          this.emitVoiceState();
        }, { once: true });

        try {
          await Promise.all(
            [...this.voiceSenders.values()].map((sender) =>
              sender.replaceTrack?.(track) ?? Promise.resolve(),
            ),
          );

          // Reconcile senders created while the first attachment was pending.
          await Promise.all(
            [...this.voiceSenders.values()].map((sender) =>
              sender.replaceTrack?.(track) ?? Promise.resolve(),
            ),
          );
        } catch (caught) {
          detachMicrophone();
          throw caught;
        }

        if (
          !this.active
          || !this.voiceDesired
          || microphoneGeneration !== this.microphoneGeneration
        ) {
          detachMicrophone();
          return;
        }

        track.enabled = true;
      } catch (caught) {
        if (
          this.active
          && this.voiceDesired
          && microphoneGeneration === this.microphoneGeneration
        ) {
          console.warn("Microphone capture failed", caught);
          this.callbacks.onError(
            this.deps.adapter.isCaptureRejected(caught)
              ? "Microphone permission was not granted."
              : "Microphone could not be started.",
          );
        }
        return;
      } finally {
        if (microphoneGeneration === this.microphoneGeneration) {
          this.requestingMicrophone = false;
          if (this.active) this.emitVoiceState();
        }
      }
    }

    const track = this.microphoneStream?.getAudioTracks()[0];
    if (!muted && !track) return;
    if (track) track.enabled = !muted;

    this.micMuted = muted;
    this.announceVoiceState();
    this.emitVoiceState();

    if (!muted) {
      for (const peer of this.peers) {
        if (peer.voiceJoined) {
          void this.createVoiceOffer(peer.id, true);
        }
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
      this.selfId = "";
      this.isHost = false;
      this.heartbeatOwnerId = "";
      this.sharingAnnounced = false;
      this.clearPingTimer();

      this.sharingRequest?.("disconnected");
      this.sharingRequest = null;
      this.signalQueues.clear();
      this.voiceSignalQueues.clear();

      for (const peerId of Array.from(this.peerConnections.keys())) {
        this.closePeer(peerId);
      }

      for (const peerId of Array.from(this.voicePeerConnections.keys())) {
        this.closeVoicePeer(peerId);
      }

      this.voiceJoined = false;
      this.emitVoiceState();

      this.peers = [];
      this.callbacks.onPeers([]);

      if (event.code === SESSION_REJECTED_CODE) {
        this.terminal = true;
        this.callbacks.onStatus("disconnected");
        this.stopSharing();
        this.callbacks.onSessionRejected?.();
        return;
      }

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

  private emitVoiceState() {
    this.callbacks.onVoiceState?.({
      joined: this.voiceDesired,
      micMuted: this.micMuted,
      requestingMicrophone: this.requestingMicrophone,
    });
  }

  private announceVoiceState() {
    if (!this.joined || !this.voiceDesired) return;

    this.send({
      type: "voice",
      joined: true,
      micMuted: this.micMuted,
    });
  }

  private shouldOfferVoice(peerId: string): boolean {
    return Boolean(this.selfId && this.selfId.localeCompare(peerId) < 0);
  }

  private async attachMicrophoneToVoicePeer(peerId: string) {
    const track = this.microphoneStream?.getAudioTracks()[0] ?? null;
    const sender = this.voiceSenders.get(peerId);

    if (sender?.replaceTrack) {
      await sender.replaceTrack(track);
    }
  }

  private createVoicePeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.voicePeerConnections.get(peerId);
    if (existing && existing.signalingState !== "closed") return existing;
    if (existing) this.voicePeerConnections.delete(peerId);

    const connection = this.deps.adapter.createPeerConnection({
      iceServers: this.iceServers,
      purpose: "voice",
    });
    const transceiver = connection.addTransceiver?.("audio", {
      direction: "sendrecv",
    });

    if (!transceiver?.sender.replaceTrack) {
      connection.close();
      throw new Error("Audio transceivers are not supported on this platform");
    }

    this.voicePeerConnections.set(peerId, connection);
    this.voiceSenders.set(peerId, transceiver.sender);

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;

      this.send({
        type: "signal",
        target: peerId,
        channel: "voice",
        data: {
          candidate: this.deps.adapter.serializeCandidate(event.candidate),
        },
      });
    };

    connection.onicecandidateerror = (event) => {
      console.warn(`[voice:${peerId}] ICE candidate error`, event);
    };
    connection.ontrack = (event) => {
      if (event.track.kind !== "audio") return;

      this.callbacks.onRemoteVoiceTrack?.(peerId, event.track);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        this.clearVoiceRecoveryTimer(peerId);
      }

      if (
        connection.connectionState === "failed"
        || connection.connectionState === "disconnected"
      ) {
        this.scheduleVoiceRecovery(peerId, connection);
      }

      if (connection.connectionState === "closed") {
        this.closeVoicePeer(peerId);
      }
    };

    return connection;
  }

  private async createVoiceOffer(peerId: string, allowNonElected = false) {
    if (
      this.voicePendingOffers.has(peerId)
      || !this.voiceJoined
      || (!allowNonElected && !this.shouldOfferVoice(peerId))
      || !this.peers.some((peer) => peer.id === peerId && peer.voiceJoined)
    ) {
      return;
    }

    const offerToken = Symbol(peerId);
    const signalingGeneration = this.signalingGeneration;
    const peerGeneration = this.voicePeerGenerations.get(peerId) ?? 0;
    let connection: RTCPeerConnection | null = null;
    this.voicePendingOffers.set(peerId, offerToken);

    const isCurrent = () =>
      this.active
      && this.joined
      && this.voiceJoined
      && signalingGeneration === this.signalingGeneration
      && peerGeneration === (this.voicePeerGenerations.get(peerId) ?? 0)
      && this.voicePendingOffers.get(peerId) === offerToken
      && this.peers.some((peer) => peer.id === peerId && peer.voiceJoined);

    try {
      try {
        await this.ensureTurnServers();
      } catch (caught) {
        console.warn(`[voice:${peerId}] TURN is unavailable`, caught);
      }

      if (!isCurrent()) return;

      connection = this.createVoicePeerConnection(peerId);
      if (connection.signalingState !== "stable") return;

      await this.attachMicrophoneToVoicePeer(peerId);
      if (!isCurrent() || this.voicePeerConnections.get(peerId) !== connection) return;

      const offer = await connection.createOffer();

      if (
        !isCurrent()
        || this.voicePeerConnections.get(peerId) !== connection
      ) {
        return;
      }

      await connection.setLocalDescription(offer);
      if (!isCurrent() || this.voicePeerConnections.get(peerId) !== connection) return;

      this.send({
        type: "signal",
        target: peerId,
        channel: "voice",
        data: connection.localDescription,
      });
      this.startVoiceOfferAnswerTimer(peerId, connection);
    } catch (caught) {
      if (isCurrent()) {
        console.error(`[voice:${peerId}] Could not create voice offer`, caught);
        if (connection && this.voicePeerConnections.get(peerId) === connection) {
          this.closeVoicePeer(peerId);
        }
        this.callbacks.onError("Room voice could not connect to a participant.");
        this.scheduleVoiceOfferRetry(peerId);
      }
    } finally {
      if (this.voicePendingOffers.get(peerId) === offerToken) {
        this.voicePendingOffers.delete(peerId);
      }
    }
  }

  private async addOrQueueVoiceCandidate(
    peerId: string,
    connection: RTCPeerConnection,
    candidate: unknown,
  ) {
    if (connection.remoteDescription) {
      await connection.addIceCandidate(candidate as never);
      return;
    }

    const pending = this.voicePendingCandidates.get(peerId) ?? [];
    pending.push(candidate);
    this.voicePendingCandidates.set(peerId, pending);
  }

  private async flushVoiceCandidates(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    const pending = this.voicePendingCandidates.get(peerId) ?? [];
    this.voicePendingCandidates.delete(peerId);

    for (const candidate of pending) {
      if (connection.signalingState === "closed") return;
      await connection.addIceCandidate(candidate as never);
    }
  }

  private async processVoiceSignal(
    from: string,
    data: SignalData,
    signalingGeneration: number,
    peerGeneration: number,
  ) {
    if (
      !this.active
      || !this.voiceJoined
      || signalingGeneration !== this.signalingGeneration
      || peerGeneration !== (this.voicePeerGenerations.get(from) ?? 0)
      || !this.peers.some((peer) => peer.id === from && peer.voiceJoined)
    ) {
      return;
    }

    if ("restartRequest" in data) return;

    const connection = this.createVoicePeerConnection(from);

    if ("candidate" in data) {
      await this.addOrQueueVoiceCandidate(from, connection, data.candidate);
      return;
    }

    if (data.type === "answer") {
      if (connection.signalingState !== "have-local-offer") return;

      await connection.setRemoteDescription(data);
      if (
        this.voicePeerConnections.get(from) !== connection
        || signalingGeneration !== this.signalingGeneration
        || peerGeneration !== (this.voicePeerGenerations.get(from) ?? 0)
      ) return;

      this.clearVoiceOfferAnswerTimer(from);
      await this.flushVoiceCandidates(from, connection);
      return;
    }

    if (data.type === "offer") {
      if (connection.signalingState === "have-local-offer") {
        if (this.shouldOfferVoice(from)) return;
        this.clearVoiceOfferAnswerTimer(from);
        await connection.setLocalDescription({ type: "rollback" });
      }
      if (connection.signalingState !== "stable") return;

      this.clearVoiceRecoveryTimer(from);
      await connection.setRemoteDescription(data);
      if (
        this.voicePeerConnections.get(from) !== connection
        || signalingGeneration !== this.signalingGeneration
        || peerGeneration !== (this.voicePeerGenerations.get(from) ?? 0)
      ) return;

      await this.flushVoiceCandidates(from, connection);
      if (this.voicePeerConnections.get(from) !== connection) return;

      await this.attachMicrophoneToVoicePeer(from);
      if (this.voicePeerConnections.get(from) !== connection) return;

      const answer = await connection.createAnswer();
      if (this.voicePeerConnections.get(from) !== connection) return;

      await connection.setLocalDescription(answer);
      if (this.voicePeerConnections.get(from) !== connection) return;

      this.send({
        type: "signal",
        target: from,
        channel: "voice",
        data: connection.localDescription,
      });
    }
  }

  private enqueueVoiceSignal(
    from: string,
    data: SignalData,
    signalingGeneration: number,
  ) {
    const peerGeneration = this.voicePeerGenerations.get(from) ?? 0;
    const previous = this.voiceSignalQueues.get(from) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.processVoiceSignal(
        from,
        data,
        signalingGeneration,
        peerGeneration,
      ))
      .catch((caught) => {
        if (
          this.active
          && this.voiceJoined
          && signalingGeneration === this.signalingGeneration
          && peerGeneration === (this.voicePeerGenerations.get(from) ?? 0)
        ) {
          console.error(`[voice:${from}] Negotiation failed`, caught);
          this.closeVoicePeer(from);
          this.callbacks.onError("Room voice negotiation failed.");
          if (this.shouldOfferVoice(from)) this.scheduleVoiceOfferRetry(from);
        }
      });

    this.voiceSignalQueues.set(from, next);
    void next.finally(() => {
      if (this.voiceSignalQueues.get(from) === next) {
        this.voiceSignalQueues.delete(from);
      }
    });
  }

  private scheduleVoiceRecovery(
    peerId: string,
    failedConnection: RTCPeerConnection,
  ) {
    if (
      this.voiceRecoveryTimers.has(peerId)
      || !this.voiceJoined
      || !this.peers.some((peer) => peer.id === peerId && peer.voiceJoined)
    ) {
      return;
    }

    const timer = setTimeout(() => {
      this.voiceRecoveryTimers.delete(peerId);

      if (
        this.voicePeerConnections.get(peerId) !== failedConnection
        || (
          failedConnection.connectionState !== "failed"
          && failedConnection.connectionState !== "disconnected"
        )
      ) {
        return;
      }

      this.closeVoicePeer(peerId);

      if (this.shouldOfferVoice(peerId)) {
        void this.createVoiceOffer(peerId);
      }
    }, 3000);

    this.voiceRecoveryTimers.set(peerId, timer);
  }

  private clearVoiceRecoveryTimer(peerId: string) {
    const timer = this.voiceRecoveryTimers.get(peerId);
    if (!timer) return;

    clearTimeout(timer);
    this.voiceRecoveryTimers.delete(peerId);
  }

  private startVoiceOfferAnswerTimer(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    this.clearVoiceOfferAnswerTimer(peerId);

    const timer = setTimeout(() => {
      this.voiceOfferAnswerTimers.delete(peerId);
      if (
        this.voicePeerConnections.get(peerId) !== connection
        || connection.signalingState !== "have-local-offer"
      ) return;

      this.closeVoicePeer(peerId);
      if (this.shouldOfferVoice(peerId)) void this.createVoiceOffer(peerId);
    }, OFFER_ANSWER_TIMEOUT_MS);

    this.voiceOfferAnswerTimers.set(peerId, timer);
  }

  private clearVoiceOfferAnswerTimer(peerId: string) {
    const timer = this.voiceOfferAnswerTimers.get(peerId);
    if (!timer) return;

    clearTimeout(timer);
    this.voiceOfferAnswerTimers.delete(peerId);
  }

  private scheduleVoiceOfferRetry(peerId: string) {
    if (
      this.voiceRetryTimers.has(peerId)
      || !this.voiceJoined
      || !this.shouldOfferVoice(peerId)
      || !this.peers.some((peer) => peer.id === peerId && peer.voiceJoined)
    ) return;

    const timer = setTimeout(() => {
      this.voiceRetryTimers.delete(peerId);
      void this.createVoiceOffer(peerId);
    }, 3000);

    this.voiceRetryTimers.set(peerId, timer);
  }

  private clearVoiceRetryTimer(peerId: string) {
    const timer = this.voiceRetryTimers.get(peerId);
    if (!timer) return;

    clearTimeout(timer);
    this.voiceRetryTimers.delete(peerId);
  }

  private closeVoicePeer(peerId: string) {
    this.voicePeerGenerations.set(
      peerId,
      (this.voicePeerGenerations.get(peerId) ?? 0) + 1,
    );

    const connection = this.voicePeerConnections.get(peerId);
    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onicecandidateerror = null;
      connection.onconnectionstatechange = null;
      connection.close();
      this.voicePeerConnections.delete(peerId);
    }

    this.clearVoiceRecoveryTimer(peerId);
    this.clearVoiceOfferAnswerTimer(peerId);
    this.clearVoiceRetryTimer(peerId);
    this.voiceSenders.delete(peerId);
    this.voicePendingCandidates.delete(peerId);
    this.voicePendingOffers.delete(peerId);
    this.callbacks.onRemoteVoiceTrack?.(peerId, null);
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
      purpose: "screen",
    });

    if (this.hasTurnServers(this.iceServers)) {
      this.turnConnections.add(connection);
    }

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
        this.clearRelayFailureTimer(peerId);
        this.clearTurnRetryTimer(peerId);
        this.turnFailedPeers.delete(peerId);
        this.relayRecoveryAttempts.delete(peerId);
        this.turnFetchFailures.delete(peerId);
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

        if (this.turnConnections.has(connection)) {
          this.restartRelayConnectionOnce(peerId, connection);
          this.scheduleRelayFailure(peerId, connection);
        } else {
          void this.upgradePeerToTurn(peerId, connection);
        }
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

    if (
      connection.remoteDescription
      && connection.signalingState !== "have-local-offer"
    ) {
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
      if (this.turnUpgrades.has(from)) {
        this.pendingRestartRequests.add(from);
      } else if (this.localStream && this.sharingAnnounced) {
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
      this.selfId = message.selfId;
      this.isHost = message.isHost;
      this.setHeartbeatOwner(message.heartbeatOwnerId);
      this.callbacks.onPeers(message.peers);
      this.callbacks.onStatus("connected");

      if (this.voiceDesired) {
        this.announceVoiceState();
        void this.ensureTurnServers().catch((caught) => {
          console.warn("TURN is unavailable for room voice", caught);
        });
      }

      if (this.localStream) {
        void this.restoreSharing();
      }

      return;
    }

    if (message.type === "heartbeat-owner") {
      this.setHeartbeatOwner(message.peerId);
      return;
    }

    if (message.type === "pong") {
      return;
    }

    if (message.type === "peer-joined") {
      const isNewPeer = !this.peers.some((peer) => peer.id === message.peer.id);

      this.signalQueues.delete(message.peer.id);
      this.closePeer(message.peer.id);
      this.voiceSignalQueues.delete(message.peer.id);
      this.closeVoicePeer(message.peer.id);

      this.peers = [
        ...this.peers.filter((peer) => peer.id !== message.peer.id),
        message.peer,
      ];

      this.callbacks.onPeers(this.peers);
      if (isNewPeer) this.callbacks.onPeerJoined?.(message.peer);

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
      const departingPeer = this.peers.find((peer) => peer.id === message.peerId);

      this.signalQueues.delete(message.peerId);
      this.voiceSignalQueues.delete(message.peerId);

      this.closePeer(message.peerId);
      this.closeVoicePeer(message.peerId);

      this.peers = this.peers.filter((peer) => peer.id !== message.peerId);

      this.callbacks.onPeers(this.peers);
      if (departingPeer) this.callbacks.onPeerLeft?.(departingPeer);

      return;
    }

    if (message.type === "peer-updated") {
      const previous = this.peers.find((peer) => peer.id === message.peer.id);
      this.peers = this.peers.map((peer) =>
        peer.id === message.peer.id ? message.peer : peer,
      );

      this.callbacks.onPeers(this.peers);
      if (previous && previous.sharing !== message.peer.sharing) {
        this.callbacks.onPeerSharingChanged?.(message.peer);
      }

      if (previous?.sharing && !message.peer.sharing) {
        this.signalQueues.delete(message.peer.id);
        this.closePeer(message.peer.id);
      }

      if (!message.peer.voiceJoined) {
        this.voiceSignalQueues.delete(message.peer.id);
        this.closeVoicePeer(message.peer.id);
      } else if (
        this.voiceJoined
        && (
          !previous?.voiceJoined
          || !this.voicePeerConnections.has(message.peer.id)
        )
        && this.shouldOfferVoice(message.peer.id)
      ) {
        void this.createVoiceOffer(message.peer.id);
      }

      return;
    }

    if (message.type === "signal") {
      if (message.channel === "voice") {
        this.enqueueVoiceSignal(
          message.from,
          message.data,
          this.signalingGeneration,
        );
      } else {
        this.enqueueSignal(
          message.from,
          message.data,
          this.signalingGeneration,
        );
      }
      return;
    }

    if (message.type === "voice-accepted") {
      this.voiceJoined = message.joined;
      this.micMuted = message.micMuted;
      this.emitVoiceState();

      if (message.joined) {
        for (const peer of this.peers) {
          if (peer.voiceJoined && this.shouldOfferVoice(peer.id)) {
            void this.createVoiceOffer(peer.id);
          }
        }
      }

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

  private setHeartbeatOwner(peerId: string) {
    this.heartbeatOwnerId = peerId;
    this.clearPingTimer();

    if (
      !this.joined
      || !this.selfId
      || this.selfId !== this.heartbeatOwnerId
      || this.socket?.readyState !== SOCKET_OPEN
    ) {
      return;
    }

    const ping = () => {
      this.send({ type: "ping", timestamp: Date.now() });
    };

    ping();
    this.heartbeatInterval = setInterval(ping, 60_000);
  }

  private hasTurnServers(servers: IceServer[]): boolean {
    return servers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => /^turns?:/i.test(url));
    });
  }

  private async ensureTurnServers(): Promise<IceServer[]> {
    if (this.hasTurnServers(this.iceServers)) {
      return this.iceServers;
    }

    if (!this.turnServersPromise) {
      this.turnServersPromise = getIceServers(this.deps.baseUrl, this.token)
        .then((servers) => {
          this.iceServers = [...fallbackIceServers, ...servers];
          return this.iceServers;
        })
        .finally(() => {
          this.turnServersPromise = null;
        });
    }

    return this.turnServersPromise;
  }

  private async upgradePeerToTurn(
    peerId: string,
    failedConnection: RTCPeerConnection,
  ) {
    if (this.turnUpgrades.has(peerId) || this.turnFailedPeers.has(peerId)) {
      return;
    }

    this.turnUpgrades.add(peerId);
    const signalingGeneration = this.signalingGeneration;
    let upgraded = false;

    try {
      await this.ensureTurnServers();

      if (
        !this.active
        || !this.joined
        || signalingGeneration !== this.signalingGeneration
        || this.peerConnections.get(peerId) !== failedConnection
        || !this.peers.some((peer) => peer.id === peerId)
      ) {
        return;
      }

      this.closePeer(peerId);
      this.turnFetchFailures.delete(peerId);
      this.clearTurnRetryTimer(peerId);
      upgraded = true;

      if (this.localStream && this.sharingAnnounced) {
        void this.createOffer(peerId);
      } else {
        this.send({
          type: "signal",
          target: peerId,
          data: { restartRequest: true },
        });
      }
    } catch (caught) {
      console.warn(`[${peerId}] TURN is unavailable`, caught);

      if (this.active && this.peers.some((peer) => peer.id === peerId)) {
        this.turnFailedPeers.add(peerId);
        this.callbacks.onError(STREAM_UNAVAILABLE_MESSAGE);
        this.scheduleTurnFetchRetry(peerId, failedConnection);
      }
    } finally {
      this.turnUpgrades.delete(peerId);

      const restartRequested = this.pendingRestartRequests.delete(peerId);
      if (
        restartRequested
        && !upgraded
        && this.localStream
        && this.sharingAnnounced
      ) {
        this.scheduleIceRecovery(peerId, 0, true);
      }
    }
  }

  private scheduleTurnFetchRetry(
    peerId: string,
    failedConnection: RTCPeerConnection,
  ) {
    const failures = (this.turnFetchFailures.get(peerId) ?? 0) + 1;
    this.turnFetchFailures.set(peerId, failures);

    if (failures > 1 || this.turnRetryTimers.has(peerId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.turnRetryTimers.delete(peerId);
      this.turnFailedPeers.delete(peerId);

      if (
        this.peerConnections.get(peerId) === failedConnection
        && failedConnection.connectionState === "failed"
      ) {
        void this.upgradePeerToTurn(peerId, failedConnection);
      }
    }, TURN_FETCH_RETRY_MS);

    this.turnRetryTimers.set(peerId, timer);
  }

  private clearTurnRetryTimer(peerId: string) {
    const timer = this.turnRetryTimers.get(peerId);
    if (!timer) return;

    clearTimeout(timer);
    this.turnRetryTimers.delete(peerId);
  }

  private scheduleRelayFailure(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    if (
      this.relayFailureTimers.has(peerId)
      || this.turnFailedPeers.has(peerId)
    ) {
      return;
    }

    const timer = setTimeout(() => {
      this.relayFailureTimers.delete(peerId);

      if (
        this.peerConnections.get(peerId) !== connection
        || connection.connectionState === "connected"
        || !this.peers.some((peer) => peer.id === peerId)
      ) {
        return;
      }

      this.turnFailedPeers.add(peerId);
      this.clearIceRecoveryTimer(peerId);
      this.callbacks.onError(STREAM_UNAVAILABLE_MESSAGE);
    }, RELAY_FAILURE_GRACE_MS);

    this.relayFailureTimers.set(peerId, timer);
  }

  private restartRelayConnectionOnce(
    peerId: string,
    connection: RTCPeerConnection,
  ) {
    if (this.relayRecoveryAttempts.has(peerId)) {
      return;
    }

    this.relayRecoveryAttempts.add(peerId);

    if (this.localStream && this.sharingAnnounced) {
      void this.createOffer(peerId, true);
    } else if (this.peerConnections.get(peerId) === connection) {
      this.send({
        type: "signal",
        target: peerId,
        data: { restartRequest: true },
      });
    }
  }

  private clearRelayFailureTimer(peerId: string) {
    const timer = this.relayFailureTimers.get(peerId);

    if (timer) {
      clearTimeout(timer);
      this.relayFailureTimers.delete(peerId);
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
    this.clearRelayFailureTimer(peerId);
    this.clearTurnRetryTimer(peerId);
    this.lastIceRestartAt.delete(peerId);
    this.turnFailedPeers.delete(peerId);
    this.relayRecoveryAttempts.delete(peerId);
    this.turnFetchFailures.delete(peerId);
    this.pendingRestartRequests.delete(peerId);

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

function isSignalData(value: unknown): value is SignalData {
  if (!value || typeof value !== "object") return false;

  const signal = value as Record<string, unknown>;
  if (signal.restartRequest === true) return true;
  if (signal.candidate && typeof signal.candidate === "object") return true;

  return (
    signal.type === "offer"
    || signal.type === "answer"
    || signal.type === "pranswer"
    || signal.type === "rollback"
  ) && (signal.sdp === undefined || typeof signal.sdp === "string");
}
