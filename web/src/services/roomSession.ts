import type { Peer, ServerMessage, SignalData, SocketStatus } from "../types";
import { fallbackIceServers, getIceServers, websocketUrl } from "../utils/signaling";
import { logSelectedIceRoute } from "../utils/webrtc";

export type RoomSessionCallbacks = {
  onStatus: (status: SocketStatus) => void;
  onPeers: (peers: Peer[]) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onIsStartingShare: (isStarting: boolean) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | null) => void;
  onConnectionState: (peerId: string, state: RTCPeerConnectionState | null) => void;
  onError: (message: string) => void;
};

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

  private active = false;
  private socket: WebSocket | null = null;
  private iceServers: RTCIceServer[] = fallbackIceServers;

  private peers: Peer[] = [];
  private localStream: MediaStream | null = null;

  private peerConnections = new Map<string, RTCPeerConnection>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private pendingOffers = new Set<string>();
  private signalQueues = new Map<string, Promise<void>>();

  private sharingRequest: ((accepted: boolean) => void) | null = null;
  private startingShare = false;
  private sharingGeneration = 0;

  private roomId = "";
  private name = "";

  constructor(callbacks: RoomSessionCallbacks) {
    this.callbacks = callbacks;
  }

  start(roomId: string, name: string) {
    this.roomId = roomId;
    this.name = name;
    this.active = true;

    this.callbacks.onStatus("connecting");
    this.callbacks.onError("");

    void this.initialize();
  }

  stop() {
    this.active = false;

    this.sharingGeneration += 1;

    this.sharingRequest?.(false);
    this.sharingRequest = null;

    this.signalQueues.clear();

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

    this.peers = [];
  }

  async startSharing() {
    if (
      this.startingShare ||
      this.localStream ||
      this.peers.some((peer) => peer.sharing) ||
      this.socket?.readyState !== WebSocket.OPEN
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
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 30,
            max: 60,
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

      /*
       * Ask signaling server whether we're
       * allowed to become this room's sharer.
       */
      const accepted = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          this.sharingRequest = null;

          this.callbacks.onError(
            "The signaling server did not respond to the share request.",
          );

          resolve(false);
        }, 5000);

        this.sharingRequest = (granted) => {
          window.clearTimeout(timeout);
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
       * Browser's native "Stop sharing" button.
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
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
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
    let resolvedIceServers: RTCIceServer[];

    try {
      resolvedIceServers = await getIceServers();

      console.log("Cloudflare ICE servers loaded", resolvedIceServers);
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

    const ws = new WebSocket(websocketUrl());

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
       * Use this exact WebSocket instead of `send()`
       * for the initial join, preventing any stale
       * socket race.
       */
      ws.send(
        JSON.stringify({
          type: "join",
          room: this.roomId,
          name: this.name,
        }),
      );
    };

    ws.onmessage = this.handleSocketMessage;

    ws.onclose = () => {
      if (!this.active) {
        return;
      }

      console.log("Signaling WebSocket disconnected");

      this.callbacks.onStatus("disconnected");

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

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(peerId);

    if (existing && existing.signalingState !== "closed") {
      return existing;
    }

    if (existing) {
      this.peerConnections.delete(peerId);
    }

    console.log(`[${peerId}] Creating peer connection`, {
      iceServers: this.iceServers,
    });

    const connection = new RTCPeerConnection({
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

      console.log(`[${peerId}] ICE candidate`, {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
        address: event.candidate.address,
        port: event.candidate.port,
      });

      this.send({
        type: "signal",
        target: peerId,
        data: {
          candidate: event.candidate.toJSON(),
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
      console.warn(`[${peerId}] ICE candidate error`, {
        url: event.url,
        address: event.address,
        port: event.port,
        errorCode: event.errorCode,
        errorText: event.errorText,
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

    return connection;
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
    candidate: RTCIceCandidateInit,
  ) {
    if (connection.signalingState === "closed") {
      return;
    }

    if (connection.remoteDescription) {
      try {
        await connection.addIceCandidate(candidate);
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
        await connection.addIceCandidate(candidate);
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

      const offer = await connection.createOffer();

      if (!this.active || generation !== this.sharingGeneration || !this.localStream) {
        return;
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
  private handleSocketMessage = (event: MessageEvent) => {
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

    this.callbacks.onRemoteStream(peerId, null);
    this.callbacks.onConnectionState(peerId, null);
  }

  private send(message: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}