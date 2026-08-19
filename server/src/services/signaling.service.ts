import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ClientMessage, Membership } from "../types/message.js";
import type { RoomToken } from "../types/room.js";
import { send } from "../utils/ws.js";
import { RoomService } from "./room.service.js";

export class SignalingService {
  constructor(
    private readonly rooms: RoomService,
    private readonly verifyRoomToken: (token: string) => RoomToken | null,
  ) {}

  handleConnection(socket: WebSocket): void {
    let membership: Membership | undefined;

    const leaveRoom = () => {
      if (!membership) return;

      const { roomId, client } = membership;
      this.rooms.removeClient(roomId, client.id);
      this.broadcast(roomId, { type: "peer-left", peerId: client.id });
      membership = undefined;
    };

    socket.on("message", (raw) => {
      const message = parseMessage(raw);
      if (!message) {
        send(socket, { type: "error", message: "Invalid message." });
        return;
      }

      if (message.type === "join") {
        const joined = this.handleJoin(socket, message, leaveRoom);
        if (joined) membership = joined;
        return;
      }

      if (!membership) {
        send(socket, { type: "error", message: "Join a room first." });
        return;
      }

      this.handleMessage(socket, message, membership);
    });

    socket.on("close", leaveRoom);
    socket.on("error", leaveRoom);
  }

  private handleJoin(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: "join" }>,
    leaveRoom: () => void,
  ): Membership | undefined {
    const roomId = message.room.trim();
    const name = message.name.trim();

    const token = this.verifyRoomToken(message.token);

    if (!token || token.roomId !== roomId || token.name !== name) {
      send(socket, {
        type: "error",
        code: "UNAUTHORIZED",
        message: "Invalid session token.",
      });
      return;
    }

    if (!roomId || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) {
      send(socket, { type: "error", message: "Invalid room ID." });
      return;
    }

    if (!name || name.length > 32) {
      send(socket, {
        type: "error",
        message: "Enter a name up to 32 characters.",
      });
      return;
    }

    leaveRoom();

    const room = this.rooms.getRoom(roomId);
    const client = {
      id: randomUUID(),
      name,
      sharing: false,
      socket,
    };

    const peers = [...room.values()].map((peer) => this.rooms.toPeer(peer));
    room.set(client.id, client);

    send(socket, { type: "room-state", selfId: client.id, peers });
    this.broadcast(
      roomId,
      { type: "peer-joined", peer: this.rooms.toPeer(client) },
      client.id,
    );

    return { roomId, client };
  }

  private handleMessage(
    socket: WebSocket,
    message: Exclude<ClientMessage, { type: "join" }>,
    membership: Membership,
  ): void {
    const { roomId, client } = membership;
    const room = this.rooms.getRoom(roomId);

    if (message.type === "signal") {
      const signal = message.data as Record<string, unknown>;

      if (signal?.type === "offer" && !client.sharing) {
        send(socket, {
          type: "error",
          message: "Start sharing before sending an offer.",
        });
        return;
      }

      const target = room.get(message.target);
      if (target) {
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
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;

    if (
      message.type === "join" &&
      typeof message.room === "string" &&
      typeof message.name === "string" &&
      typeof message.token === "string"
    ) {
      return { type: "join", room: message.room, name: message.name, token: message.token };
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

    return null;
  } catch {
    return null;
  }
}