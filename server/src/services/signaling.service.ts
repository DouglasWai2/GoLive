import type { WebSocket } from "ws";
import type { ClientMessage, Membership } from "../types/message.js";
import type { RoomToken } from "../types/room.js";
import { send } from "../utils/ws.js";
import { RoomService } from "./room.service.js";

const MAX_CONNECTIONS_PER_IP = 20;
const MAX_MESSAGES_PER_WINDOW = 120;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_PEERS_PER_ROOM = 10;
const AUTH_TIMEOUT_MS = 10_000;
const SESSION_REPLACED_CODE = 4001;
const SESSION_REJECTED_CODE = 4003;
const HEARTBEAT_LEASE_MS = 150_000;

const connectionsByIp = new Map<string, number>();

export class SignalingService {
  private readonly heartbeatLeases = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly rooms: RoomService,
    private readonly verifyRoomToken: (token: string) => RoomToken | null,
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
        const previousHeartbeatOwnerId = this.rooms.getHeartbeatOwner(roomId);
        this.rooms.removeClient(roomId, client.id);
        this.broadcast(roomId, { type: "peer-left", peerId: client.id });

        const heartbeatOwnerId = this.rooms.getHeartbeatOwner(roomId);
        if (heartbeatOwnerId && heartbeatOwnerId !== previousHeartbeatOwnerId) {
          this.broadcast(roomId, {
            type: "heartbeat-owner",
            peerId: heartbeatOwnerId,
          });
        }

        if (heartbeatOwnerId) this.scheduleHeartbeatLease(roomId, heartbeatOwnerId);
        else this.clearHeartbeatLease(roomId);
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

    socket.on("message", (raw) => {
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

      this.handleMessage(socket, message, membership);
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
    const previousHeartbeatOwnerId = this.rooms.getHeartbeatOwner(roomId);

    if (existing && existing.socket !== socket) {
      /*
       * Another tab is using the same session. Evict it so the room
       * keeps exactly one peer per session.
       */
      existing.socket.close(SESSION_REPLACED_CODE, "Session opened in another tab");

      if (existing.sharing) {
        this.broadcast(
          roomId,
          { type: "peer-updated", peer: { id: peerId, name, sharing: false } },
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
      name,
      sharing: false,
      socket,
      connectedAt: new Date().toISOString(),
    };

    const peers = [...room.values()]
      .filter((peer) => peer.id !== peerId)
      .map((peer) => this.rooms.toPeer(peer));
    room.set(client.id, client);
    const heartbeatOwnerId = this.rooms.isHost(roomId, peerId)
      ? this.rooms.reclaimHostHeartbeat(roomId, peerId) ?? client.id
      : this.rooms.refreshHeartbeatOwner(roomId) ?? client.id;
    this.scheduleHeartbeatLease(roomId, heartbeatOwnerId);

    send(socket, {
      type: "room-state",
      selfId: client.id,
      heartbeatOwnerId,
      isHost: this.rooms.isHost(roomId, client.id),
      peers,
    });
    this.broadcast(
      roomId,
      { type: "peer-joined", peer: this.rooms.toPeer(client) },
      client.id,
    );

    if (heartbeatOwnerId !== previousHeartbeatOwnerId) {
      this.broadcast(
        roomId,
        { type: "heartbeat-owner", peerId: heartbeatOwnerId },
        client.id,
      );
    }

    return { roomId, client };
  }

  private handleMessage(
    socket: WebSocket,
    message: Exclude<ClientMessage, { type: "join" } | { type: "auth" }>,
    membership: Membership,
  ): void {
    const { roomId, client } = membership;
    const room = this.rooms.getRoom(roomId);

    if (
      message.type !== "ping"
      && this.rooms.isHost(roomId, client.id)
      && this.rooms.getHeartbeatOwner(roomId) !== client.id
    ) {
      const heartbeatOwnerId = this.rooms.reclaimHostHeartbeat(roomId, client.id);
      if (heartbeatOwnerId) {
        this.broadcast(roomId, {
          type: "heartbeat-owner",
          peerId: heartbeatOwnerId,
        });
        this.scheduleHeartbeatLease(roomId, heartbeatOwnerId);
      }
    }

    if (message.type === "signal") {
      const signal = message.data as Record<string, unknown>;

      if (signal?.type === "offer" && !client.sharing) {
        send(socket, {
          type: "error",
          message: "Start sharing before sending an offer.",
        });
        return;
      }

      /*
       * The target is resolved from the sender's own room,
       * so sender.roomId === target.roomId by construction.
       */
      const target = room.get(message.target);
      if (target && target.id !== client.id) {
        send(target.socket, {
          type: "signal",
          from: client.id,
          data: message.data,
        });
      }
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

    if (message.type === "ping" && typeof message.timestamp === "number") {
      if (this.rooms.getHeartbeatOwner(roomId) === client.id) {
        send(socket, { type: "pong", timestamp: message.timestamp });
        this.scheduleHeartbeatLease(roomId, client.id);
      }
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

  private scheduleHeartbeatLease(roomId: string, ownerId: string): void {
    this.clearHeartbeatLease(roomId);

    const timer = setTimeout(() => {
      this.heartbeatLeases.delete(roomId);

      if (this.rooms.getHeartbeatOwner(roomId) !== ownerId) {
        return;
      }

      const nextOwnerId = this.rooms.rotateHeartbeatOwner(roomId);
      if (!nextOwnerId) return;

      if (nextOwnerId !== ownerId) {
        this.broadcast(roomId, {
          type: "heartbeat-owner",
          peerId: nextOwnerId,
        });
      }

      this.scheduleHeartbeatLease(roomId, nextOwnerId);
    }, HEARTBEAT_LEASE_MS);

    timer.unref?.();
    this.heartbeatLeases.set(roomId, timer);
  }

  private clearHeartbeatLease(roomId: string): void {
    const timer = this.heartbeatLeases.get(roomId);
    if (!timer) return;

    clearTimeout(timer);
    this.heartbeatLeases.delete(roomId);
  }
}

function parseMessage(raw: Buffer | ArrayBuffer | Buffer[]): ClientMessage | null {
  try {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;

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
      message.data !== undefined
    ) {
      return { type: "signal", target: message.target, data: message.data };
    }

    if (message.type === "sharing" && typeof message.sharing === "boolean") {
      return { type: "sharing", sharing: message.sharing };
    }

    if (message.type === "ping" && typeof message.timestamp === "number") {
      return { type: "ping", timestamp: message.timestamp };
    }

    if (message.type === "heartbeat-reclaim") {
      return { type: "heartbeat-reclaim" };
    }

    return null;
  } catch {
    return null;
  }
}
