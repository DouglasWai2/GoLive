import type { WebSocket } from "ws";
import type { ClientMessage, Membership } from "../types/message.js";
import type { RoomToken } from "../types/room.js";
import { send } from "../utils/ws.js";
import { RoomService } from "./room.service.js";
import type { CatalogService } from "./catalog.service.js";

const MAX_CONNECTIONS_PER_IP = 20;
const MAX_MESSAGES_PER_WINDOW = 120;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_PEERS_PER_ROOM = 10;
const AUTH_TIMEOUT_MS = 10_000;
const SESSION_REPLACED_CODE = 4001;
const SESSION_REJECTED_CODE = 4003;

const connectionsByIp = new Map<string, number>();

export class SignalingService {
  constructor(
    private readonly rooms: RoomService,
    private readonly verifyRoomToken: (token: string) => RoomToken | null,
    private readonly catalog?: CatalogService,
  ) {}

  handleConnection(socket: WebSocket, ip: string): void {
    const connectionCount = connectionsByIp.get(ip) ?? 0;
    if (connectionCount >= MAX_CONNECTIONS_PER_IP) {
      socket.close(1008, "Too many connections");
      return;
    }
    connectionsByIp.set(ip, connectionCount + 1);

    let session: RoomToken | undefined;
    let membership: Membership | undefined;

    const authTimeout = setTimeout(() => {
      socket.close(1008, "Authentication timeout");
    }, AUTH_TIMEOUT_MS);

    const messageTimestamps: number[] = [];

    const leaveRoom = () => {
      if (!membership) return;

      const { roomId, client } = membership;

      /*
       * Only remove the room entry if it still points at this socket.
       * A replaced session (opened in another tab) must not delete the
       * new active connection when its old socket closes.
       */
      if (this.rooms.getClient(roomId, client.id)?.socket === client.socket) {
        this.rooms.removeClient(roomId, client.id);
        this.broadcast(roomId, { type: "peer-left", peerId: client.id });
      }

      membership = undefined;
    };

    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      clearTimeout(authTimeout);
      leaveRoom();

      const count = connectionsByIp.get(ip) ?? 0;
      if (count <= 1) connectionsByIp.delete(ip);
      else connectionsByIp.set(ip, count - 1);
    };

    const handleMessage = async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const now = Date.now();
      messageTimestamps.push(now);
      while ((messageTimestamps[0] ?? 0) < now - MESSAGE_WINDOW_MS) {
        messageTimestamps.shift();
      }
      if (messageTimestamps.length > MAX_MESSAGES_PER_WINDOW) {
        socket.close(1008, "Rate limit exceeded");
        return;
      }

      const message = parseMessage(raw);
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
        const joined = this.handleJoin(socket, message, session, leaveRoom);
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

    // Database authorization is asynchronous; preserve message order for
    // auth, join, and WebRTC offers/candidates on each socket.
    let pending = Promise.resolve();
    socket.on("message", (raw) => {
      pending = pending.then(() => handleMessage(raw)).catch(() => {
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
      existing.socket.close(SESSION_REPLACED_CODE, "Session opened in another tab");

      if (existing.sharing || existing.voiceJoined) {
        this.broadcast(
          roomId,
          {
            type: "peer-updated",
            peer: {
              id: peerId,
              name,
              sharing: false,
              voiceJoined: false,
              micMuted: true,
            },
          },
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
        && message.channel === "screen"
        && !client.sharing
      ) {
        send(socket, {
          type: "error",
          message: "Start sharing before sending an offer.",
        });
        return;
      }

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
      if (
        target
        && target.id !== client.id
        && (message.channel === "screen" || target.voiceJoined)
      ) {
        send(target.socket, {
          type: "signal",
          from: client.id,
          channel: message.channel,
          data: message.data,
        });
      }
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
        const activeSharer = [...room.values()].find(
          (peer) => peer.id !== client.id && peer.sharing,
        );
        if (activeSharer) {
          send(socket, {
            type: "error",
            code: "SHARER_EXISTS",
            message: `${activeSharer.name} is already sharing.`,
          });
          return;
        }
      }

      client.sharing = message.sharing;
      send(socket, { type: "sharing-accepted", sharing: message.sharing });
      this.broadcast(
        roomId,
        { type: "peer-updated", peer: this.rooms.toPeer(client) },
        client.id,
      );
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
}

function parseMessage(raw: Buffer | ArrayBuffer | Buffer[]): ClientMessage | null {
  try {
    const serialized = raw.toString();
    if (serialized.length > 64_000) return null;

    const message = JSON.parse(serialized) as Record<string, unknown>;

    if (message.type === "auth" && typeof message.token === "string") {
      return { type: "auth", token: message.token };
    }

    if (
      message.type === "join" &&
      typeof message.room === "string" &&
      typeof message.name === "string"
    ) {
      return { type: "join", room: message.room, name: message.name };
    }

    if (
      message.type === "signal" &&
      typeof message.target === "string" &&
      isSignalData(message.data)
    ) {
      if (
        message.channel !== undefined
        && message.channel !== "screen"
        && message.channel !== "voice"
      ) {
        return null;
      }

      const channel = message.channel === "voice" ? "voice" : "screen";
      return { type: "signal", target: message.target, channel, data: message.data };
    }

    if (message.type === "sharing" && typeof message.sharing === "boolean") {
      return { type: "sharing", sharing: message.sharing };
    }

    if (
      message.type === "voice"
      && typeof message.joined === "boolean"
      && typeof message.micMuted === "boolean"
    ) {
      return {
        type: "voice",
        joined: message.joined,
        micMuted: message.micMuted,
      };
    }

    if (message.type === "ping" && typeof message.timestamp === "number") {
      return { type: "ping", timestamp: message.timestamp };
    }

    return null;
  } catch {
    return null;
  }
}

function isSignalData(value: unknown): boolean {
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
