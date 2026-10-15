import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { normalizeIP } from "@fastify/rate-limit";
import type { ClientMessage, Membership } from "../types/message.js";
import type { Client, RoomToken } from "../types/room.js";
import { MAX_SIGNALING_MESSAGE_BYTES, send } from "../utils/ws.js";
import { RoomService } from "./room.service.js";
import type { CatalogService } from "./catalog.service.js";
import { isValidRoomId } from "../utils/room-id.js";
import { DISPLAY_NAME_PATTERN } from "../utils/validation.js";

const MAX_CONNECTIONS_PER_IP = 20;
const MAX_MESSAGES_PER_WINDOW = 120;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_QUEUED_MESSAGES = 64;
const MAX_QUEUED_BYTES = 512 * 1024;
const MAX_PEERS_PER_ROOM = 10;
const AUTH_TIMEOUT_MS = 10_000;
const SESSION_REPLACED_CODE = 4001;
const SESSION_REJECTED_CODE = 4003;
const CONNECTION_LEASE_REFRESH_MS = 30_000;
const STREAM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const connectionsByIp = new Map<string, number>();

export class SignalingService {
  constructor(
    private readonly rooms: RoomService,
    private readonly verifyRoomToken: (token: string) => RoomToken | null,
    private readonly catalog?: CatalogService,
  ) {}

  handleConnection(socket: WebSocket, ip: string): void {
    const connectionKey = normalizeIP(ip);
    const connectionCount = connectionsByIp.get(connectionKey) ?? 0;
    if (connectionCount >= MAX_CONNECTIONS_PER_IP) {
      socket.close(1008, "Too many connections");
      return;
    }
    connectionsByIp.set(connectionKey, connectionCount + 1);

    let session: RoomToken | undefined;
    let membership: Membership | undefined;

    const authTimeout = setTimeout(() => {
      socket.close(1008, "Authentication timeout");
    }, AUTH_TIMEOUT_MS);

    const messageTimestamps: number[] = [];
    const messageKinds: string[] = [];

    const leaveRoom = () => {
      if (!membership) return;

      const { roomId, client } = membership;

      /*
       * Only remove the room entry if it still points at this socket.
       * A replaced session (opened in another tab) must not delete the
       * new active connection when its old socket closes.
       */
      if (this.rooms.getClient(roomId, client.id)?.socket === client.socket) {
        this.unsubscribeClient(roomId, client);
        this.stopSharing(roomId, client);
        this.rooms.removeClient(roomId, client.id);
        this.broadcast(roomId, { type: "peer-left", peerId: client.id });
      }

      membership = undefined;
    };

    let cleanedUp = false;
    let sharedConnectionLease: string | undefined;
    let connectionLeaseHeartbeat: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      clearTimeout(authTimeout);
      if (connectionLeaseHeartbeat) clearInterval(connectionLeaseHeartbeat);
      leaveRoom();

      const count = connectionsByIp.get(connectionKey) ?? 0;
      if (count <= 1) connectionsByIp.delete(connectionKey);
      else connectionsByIp.set(connectionKey, count - 1);

      if (sharedConnectionLease && this.catalog) {
        const leaseId = sharedConnectionLease;
        sharedConnectionLease = undefined;
        void this.catalog.releaseWebSocketConnection(leaseId).catch(() => {});
      }
    };

    const catalog = this.catalog;
    const connectionReady = catalog
      ? catalog.acquireWebSocketConnection(connectionKey, MAX_CONNECTIONS_PER_IP).then((leaseId) => {
        if (!leaseId) {
          socket.close(1008, "Too many connections");
          return false;
        }
        if (cleanedUp || socket.readyState !== socket.OPEN) {
          void catalog.releaseWebSocketConnection(leaseId).catch(() => {});
          return false;
        }

        sharedConnectionLease = leaseId;
        connectionLeaseHeartbeat = setInterval(() => {
          const currentLease = sharedConnectionLease;
          if (!currentLease || cleanedUp) return;
          void catalog.renewWebSocketConnection(currentLease).then((renewed) => {
            if (!renewed && socket.readyState === socket.OPEN) {
              socket.close(1011, "Connection quota expired");
            }
          }).catch(() => {
            if (socket.readyState === socket.OPEN) socket.close(1011, "Connection quota unavailable");
          });
        }, CONNECTION_LEASE_REFRESH_MS);
        connectionLeaseHeartbeat.unref?.();
        return true;
      }).catch(() => {
        socket.close(1011, "Connection quota unavailable");
        return false;
      })
      : Promise.resolve(true);

    const handleMessage = async (message: ClientMessage | null) => {
      if (!await connectionReady) return;
      if (!message) {
        send(socket, { type: "error", message: "Invalid message." });
        return;
      }

      /*
       * AUTH MUST COME FIRST
       */
      if (!session) {
        if (message.type !== "auth") {
          socket.close(1008, "Authentication required");
          return;
        }

        const verified = this.verifyRoomToken(message.token);
        if (!verified) {
          socket.close(1008, "Invalid session");
          return;
        }

        if (!this.rooms.isCurrentRoomInstance(
          verified.roomId,
          verified.roomInstanceId,
        )) {
          socket.close(SESSION_REJECTED_CODE, "Room session expired");
          return;
        }

        if (this.catalog) {
          try {
            if (!verified.userId || !await this.catalog.isMember(verified.userId, verified.roomId)) {
              socket.close(SESSION_REJECTED_CODE, "Room access revoked");
              return;
            }
          } catch {
            socket.close(1011, "Membership unavailable");
            return;
          }
        }

        if (socket.readyState !== socket.OPEN) return;

        session = verified;
        clearTimeout(authTimeout);
        send(socket, { type: "authenticated" });
        return;
      }

      if (
        membership &&
        this.rooms.getClient(membership.roomId, membership.client.id)?.socket !== socket
      ) {
        socket.close(SESSION_REPLACED_CODE, "Session opened in another tab");
        return;
      }

      if (message.type === "join") {
        let currentName = session.name;
        if (this.catalog) {
          try {
            const currentMembership = session.userId
              ? await this.catalog.getUserMembership(session.userId, session.roomId)
              : null;
            if (!currentMembership) {
              socket.close(SESSION_REJECTED_CODE, "Room access revoked");
              return;
            }
            currentName = currentMembership.name;
          } catch {
            socket.close(1011, "Membership unavailable");
            return;
          }
        }
        if (socket.readyState !== socket.OPEN) return;
        const joined = this.handleJoin(
          socket,
          { ...message, name: currentName },
          { ...session, name: currentName },
          leaveRoom,
        );
        if (joined) membership = joined;
        return;
      }

      if (message.type === "auth") {
        return;
      }

      if (!membership) {
        send(socket, { type: "error", message: "Join a room first." });
        return;
      }

      if (this.catalog) {
        try {
          if (!session.userId || !await this.catalog.isMember(session.userId, session.roomId)) {
            socket.close(SESSION_REJECTED_CODE, "Room access revoked");
            return;
          }
        } catch {
          socket.close(1011, "Membership unavailable");
          return;
        }
      }
      if (socket.readyState !== socket.OPEN) return;

      this.handleMessage(socket, message, membership);
    };

    let queuedMessages = 0;
    let queuedBytes = 0;

    // Database authorization is asynchronous; preserve message order while
    // bounding buffered work before it enters the serialized queue.
    let pending = Promise.resolve();
    socket.on("message", (raw, isBinary) => {
      if (socket.readyState !== socket.OPEN) return;
      if (isBinary) {
        socket.close(1003, "Text messages required");
        return;
      }

      const now = Date.now();
      while (messageTimestamps.length > 0 && messageTimestamps[0]! < now - MESSAGE_WINDOW_MS) {
        messageTimestamps.shift();
        messageKinds.shift();
      }
      const message = parseMessage(raw);
      const signal = message?.type === "signal" ? message.data as Record<string, unknown> : null;
      messageTimestamps.push(now);
      messageKinds.push(message?.type === "signal" && signal
        ? `${message.channel}:${"candidate" in signal || "candidates" in signal ? "candidate" : "restartRequest" in signal ? "restart" : "sdp"}`
        : message?.type ?? "invalid");
      if (messageTimestamps.length > MAX_MESSAGES_PER_WINDOW) {
        const counts: Record<string, number> = {};
        for (const kind of messageKinds) counts[kind] = (counts[kind] ?? 0) + 1;
        console.warn("Signaling WebSocket rate limit exceeded", { counts });
        socket.close(1008, "Rate limit exceeded");
        return;
      }

      const rawBytes = rawMessageLength(raw);
      if (
        rawBytes > MAX_SIGNALING_MESSAGE_BYTES
        || queuedMessages + 1 > MAX_QUEUED_MESSAGES
        || queuedBytes + rawBytes > MAX_QUEUED_BYTES
      ) {
        socket.close(1008, "Too much pending signaling data");
        return;
      }

      queuedMessages += 1;
      queuedBytes += rawBytes;
      pending = pending.then(async () => {
        queuedMessages -= 1;
        queuedBytes -= rawBytes;
        if (socket.readyState !== socket.OPEN) return;
        await handleMessage(message);
      }).catch(() => {
        socket.close(1011, "Signaling unavailable");
      });
    });

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private handleJoin(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: "join" }>,
    session: RoomToken,
    leaveRoom: () => void,
  ): Membership | undefined {
    if (message.room !== session.roomId || message.name !== session.name) {
      socket.close(1008, "Session mismatch");
      return;
    }

    if (!this.rooms.isCurrentRoomInstance(
      session.roomId,
      session.roomInstanceId,
    )) {
      socket.close(SESSION_REJECTED_CODE, "Room session expired");
      return;
    }

    const roomId = session.roomId;
    const name = session.name;
    const currentClient = this.rooms.getClient(roomId, session.sessionId);

    if (currentClient?.socket === socket) {
      return { roomId, client: currentClient };
    }

    leaveRoom();

    const room = this.rooms.getRoom(roomId);

    /*
     * The peer id is the session id, so a session reconnecting
     * (reload, or a new tab) maps to the same peer.
     */
    const peerId = session.sessionId;

    const existing = room.get(peerId);

    if (existing && existing.socket !== socket) {
      /*
       * Another tab is using the same session. Evict it so the room
       * keeps exactly one peer per session.
       */
      const wasActive = existing.sharing || existing.voiceJoined;
      this.unsubscribeClient(roomId, existing);
      this.stopSharing(roomId, existing);
      existing.voiceJoined = false;
      existing.micMuted = true;
      existing.socket.close(SESSION_REPLACED_CODE, "Session opened in another tab");

      if (wasActive) {
        this.broadcast(
          roomId,
          { type: "peer-updated", peer: this.rooms.toPeer(existing) },
          peerId,
        );
      }
    }

    if (!existing && room.size >= MAX_PEERS_PER_ROOM) {
      send(socket, {
        type: "error",
        code: "ROOM_FULL",
        message: "This room is full.",
      });
      socket.close(1008, "Room full");
      return;
    }

    const client = {
      id: peerId,
      sessionId: peerId,
      userId: session.userId,
      name,
      sharing: false,
      voiceJoined: false,
      micMuted: true,
      socket,
      connectedAt: new Date().toISOString(),
    };

    const peers = [...room.values()]
      .filter((peer) => peer.id !== peerId)
      .map((peer) => this.rooms.toPeer(peer));
    room.set(client.id, client);

    send(socket, {
      type: "room-state",
      selfId: client.id,
      peers,
    });
    this.broadcast(
      roomId,
      { type: "peer-joined", peer: this.rooms.toPeer(client) },
      client.id,
    );

    return { roomId, client };
  }

  private handleMessage(
    socket: WebSocket,
    message: Exclude<ClientMessage, { type: "join" } | { type: "auth" }>,
    membership: Membership,
  ): void {
    const { roomId, client } = membership;
    const room = this.rooms.getRoom(roomId);

    if (message.type === "signal") {
      const signal = message.data as Record<string, unknown>;
      if (
        signal?.type === "offer"
        && message.channel === "voice"
        && !client.voiceJoined
      ) {
        send(socket, {
          type: "error",
          message: "Join room voice before sending a voice offer.",
        });
        return;
      }

      /*
       * The target is resolved from the sender's own room,
       * so sender.roomId === target.roomId by construction.
       */
      const target = room.get(message.target);
      if (!target || target.id === client.id) return;

      if (message.channel === "voice") {
        if (!target.voiceJoined) return;
        if (Array.isArray(signal.candidates)) {
          for (const candidate of signal.candidates) {
            send(target.socket, {
              type: "signal",
              from: client.id,
              channel: "voice",
              data: { candidate },
            });
          }
          return;
        }
        send(target.socket, {
          type: "signal",
          from: client.id,
          channel: message.channel,
          data: message.data,
        });
        return;
      }

      const streamId = message.streamId;
      if (!streamId) return;

      const signalType = signal.type;
      const isCandidate = Boolean(signal.candidate) || Array.isArray(signal.candidates);
      const isPublisher = client.sharing
        && client.streamId === streamId
        && target.subscribedStreamId === streamId;
      const isSubscriber = client.subscribedStreamId === streamId
        && target.sharing
        && target.streamId === streamId;

      const allowed = signalType === "offer"
        ? isPublisher
        : signalType === "answer" || signal.restartRequest === true
          ? isSubscriber
          : isCandidate && (isPublisher || isSubscriber);

      if (!allowed) {
        send(socket, {
          type: "error",
          code: "INVALID_STREAM_SIGNAL",
          message: "This screen-sharing signal is not authorized.",
          streamId,
          targetPeerId: target.id,
        });
        return;
      }

      if (Array.isArray(signal.candidates)) {
        for (const candidate of signal.candidates) {
          send(target.socket, {
            type: "signal",
            from: client.id,
            channel: "screen",
            streamId,
            data: { candidate },
          });
        }
        return;
      }

      send(target.socket, {
        type: "signal",
        from: client.id,
        channel: "screen",
        streamId,
        data: message.data,
      });
      return;
    }

    if (message.type === "voice") {
      client.voiceJoined = message.joined;
      client.micMuted = message.joined ? message.micMuted : true;

      send(socket, {
        type: "voice-accepted",
        joined: client.voiceJoined,
        micMuted: client.micMuted,
      });
      this.broadcast(
        roomId,
        { type: "peer-updated", peer: this.rooms.toPeer(client) },
        client.id,
      );
      return;
    }

    if (message.type === "sharing") {
      if (message.sharing) {
        client.sharing = true;
        client.streamId ??= randomUUID();
        send(socket, {
          type: "sharing-accepted",
          sharing: true,
          streamId: client.streamId,
        });
      } else {
        if (message.streamId && client.streamId !== message.streamId) {
          send(socket, {
            type: "error",
            code: "STALE_STREAM",
            message: "This screen-sharing session has already ended.",
          });
          return;
        }

        this.stopSharing(roomId, client);
        send(socket, { type: "sharing-accepted", sharing: false });
      }

      this.broadcast(
        roomId,
        { type: "peer-updated", peer: this.rooms.toPeer(client) },
        client.id,
      );
      return;
    }

    if (message.type === "subscribe") {
      if (message.streamId === null) {
        this.unsubscribeClient(roomId, client);
        send(socket, { type: "subscription-accepted", streamId: null });
        return;
      }

      const owner = [...room.values()].find(
        (peer) => peer.sharing && peer.streamId === message.streamId,
      );
      if (!owner || owner.id === client.id) {
        send(socket, {
          type: "error",
          code: "STREAM_UNAVAILABLE",
          message: "This screen is no longer available.",
          streamId: message.streamId,
        });
        return;
      }

      if (client.subscribedStreamId !== message.streamId) {
        this.unsubscribeClient(roomId, client);
        client.subscribedStreamId = message.streamId;
        send(owner.socket, {
          type: "stream-subscriber",
          peerId: client.id,
          streamId: message.streamId,
          subscribed: true,
        });
      }

      send(socket, {
        type: "subscription-accepted",
        streamId: message.streamId,
        ownerPeerId: owner.id,
      });
    }

    if (message.type === "ping") {
      send(socket, { type: "pong", timestamp: message.timestamp });
    }
  }

  private broadcast(
    roomId: string,
    message: unknown,
    excludedPeerId?: string,
  ): void {
    for (const client of this.rooms.findRoom(roomId)?.values() ?? []) {
      if (client.id !== excludedPeerId) send(client.socket, message);
    }
  }

  private unsubscribeClient(roomId: string, client: Client): void {
    const streamId = client.subscribedStreamId;
    if (!streamId) return;

    delete client.subscribedStreamId;
    const owner = [...(this.rooms.findRoom(roomId)?.values() ?? [])].find(
      (peer) => peer.sharing && peer.streamId === streamId,
    );
    if (owner) {
      send(owner.socket, {
        type: "stream-subscriber",
        peerId: client.id,
        streamId,
        subscribed: false,
      });
    }
  }

  private stopSharing(
    roomId: string,
    owner: Client,
  ): void {
    const streamId = owner.streamId;
    owner.sharing = false;
    delete owner.streamId;
    if (!streamId) return;

    for (const viewer of this.rooms.findRoom(roomId)?.values() ?? []) {
      if (viewer.subscribedStreamId !== streamId) continue;
      delete viewer.subscribedStreamId;
      send(viewer.socket, { type: "subscription-ended", streamId });
    }
  }

  updateUserName(userId: string, name: string): void {
    for (const { roomId, client } of this.rooms.updateUserName(userId, name)) {
      this.broadcast(roomId, { type: "peer-updated", peer: this.rooms.toPeer(client) }, client.id);
    }
  }
}

function rawMessageLength(raw: Buffer | ArrayBuffer | Buffer[]): number {
  if (Buffer.isBuffer(raw)) return raw.byteLength;
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return raw.reduce((total, part) => total + part.byteLength, 0);
}

function rawMessageBuffer(raw: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return Buffer.concat(raw);
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISPLAY_NAME_REGEX = new RegExp(DISPLAY_NAME_PATTERN);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseMessage(raw: Buffer | ArrayBuffer | Buffer[]): ClientMessage | null {
  try {
    if (rawMessageLength(raw) > MAX_SIGNALING_MESSAGE_BYTES) return null;
    const message = JSON.parse(rawMessageBuffer(raw).toString("utf8")) as Record<string, unknown>;

    if (
      message.type === "auth"
      && hasOnlyKeys(message, ["type", "token"])
      && typeof message.token === "string"
      && message.token.length > 0
      && message.token.length <= 4096
    ) {
      return { type: "auth", token: message.token };
    }

    if (
      message.type === "join"
      && hasOnlyKeys(message, ["type", "room", "name"])
      && typeof message.room === "string"
      && isValidRoomId(message.room)
      && typeof message.name === "string"
      && message.name.length > 0
      && message.name.length <= 32
      && message.name === message.name.trim()
      && DISPLAY_NAME_REGEX.test(message.name)
    ) {
      return { type: "join", room: message.room, name: message.name };
    }

    if (
      message.type === "signal"
      && hasOnlyKeys(message, ["type", "target", "channel", "streamId", "data"])
      && typeof message.target === "string"
      && SESSION_ID_PATTERN.test(message.target)
    ) {
      if (
        message.channel !== undefined
        && message.channel !== "screen"
        && message.channel !== "voice"
      ) {
        return null;
      }

      const data = parseSignalData(message.data);
      if (!data) return null;
      const channel = message.channel === "voice" ? "voice" : "screen";
      if (channel === "screen" && !isValidStreamId(message.streamId)) return null;
      if (channel === "voice" && message.streamId !== undefined) return null;
      return {
        type: "signal",
        target: message.target,
        channel,
        ...(channel === "screen" ? { streamId: message.streamId as string } : {}),
        data,
      };
    }

    if (
      message.type === "sharing"
      && hasOnlyKeys(message, ["type", "sharing", "streamId"])
      && typeof message.sharing === "boolean"
      && (message.streamId === undefined || isValidStreamId(message.streamId))
    ) {
      return {
        type: "sharing",
        sharing: message.sharing,
        ...(typeof message.streamId === "string" ? { streamId: message.streamId } : {}),
      };
    }

    if (
      message.type === "subscribe"
      && hasOnlyKeys(message, ["type", "streamId"])
      && (message.streamId === null || isValidStreamId(message.streamId))
    ) {
      return { type: "subscribe", streamId: message.streamId as string | null };
    }

    if (
      message.type === "voice"
      && hasOnlyKeys(message, ["type", "joined", "micMuted"])
      && typeof message.joined === "boolean"
      && typeof message.micMuted === "boolean"
    ) {
      return {
        type: "voice",
        joined: message.joined,
        micMuted: message.micMuted,
      };
    }

    if (
      message.type === "ping"
      && hasOnlyKeys(message, ["type", "timestamp"])
      && typeof message.timestamp === "number"
      && Number.isFinite(message.timestamp)
    ) {
      return { type: "ping", timestamp: message.timestamp };
    }

    return null;
  } catch {
    return null;
  }
}

function parseSignalData(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  if (value.restartRequest === true) {
    return hasOnlyKeys(value, ["restartRequest"]) ? { restartRequest: true } : null;
  }

  if (Object.hasOwn(value, "candidate")) {
    if (!hasOnlyKeys(value, ["candidate"])) return null;
    const candidate = parseIceCandidate(value.candidate);
    return candidate ? { candidate } : null;
  }

  if (Object.hasOwn(value, "candidates")) {
    if (!hasOnlyKeys(value, ["candidates"]) || !Array.isArray(value.candidates)
      || value.candidates.length < 1 || value.candidates.length > 8) return null;
    const candidates = value.candidates.map(parseIceCandidate);
    return candidates.every((candidate) => candidate !== null) ? { candidates } : null;
  }

  if (
    (value.type === "offer" || value.type === "answer" || value.type === "pranswer" || value.type === "rollback")
    && hasOnlyKeys(value, ["type", "sdp"])
    && (value.sdp === undefined || (typeof value.sdp === "string" && value.sdp.length <= MAX_SIGNALING_MESSAGE_BYTES))
  ) {
    return value.sdp === undefined ? { type: value.type } : { type: value.type, sdp: value.sdp };
  }
  return null;
}

function parseIceCandidate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"])) return null;

  const candidate: Record<string, unknown> = {};
  if (value.candidate !== undefined) {
    if (typeof value.candidate !== "string" || value.candidate.length > 4096) return null;
    candidate.candidate = value.candidate;
  }
  if (value.sdpMid !== undefined) {
    if (value.sdpMid !== null && (typeof value.sdpMid !== "string" || value.sdpMid.length > 256)) return null;
    candidate.sdpMid = value.sdpMid;
  }
  if (value.sdpMLineIndex !== undefined) {
    if (
      value.sdpMLineIndex !== null
      && (!Number.isInteger(value.sdpMLineIndex)
        || Number(value.sdpMLineIndex) < 0
        || Number(value.sdpMLineIndex) > 255)
    ) return null;
    candidate.sdpMLineIndex = value.sdpMLineIndex;
  }
  if (value.usernameFragment !== undefined) {
    if (value.usernameFragment !== null && (typeof value.usernameFragment !== "string" || value.usernameFragment.length > 256)) return null;
    candidate.usernameFragment = value.usernameFragment;
  }
  return candidate;
}

function isValidStreamId(value: unknown): value is string {
  return typeof value === "string" && STREAM_ID_PATTERN.test(value);
}
