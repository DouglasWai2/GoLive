import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  findRoom,
  getRoom,
  removeClient,
  toPeer,
  type Client,
} from "./rooms.js";

type Membership = {
  roomId: string;
  client: Client;
};

type ClientMessage =
  | { type: "join"; room: string; name: string }
  | { type: "signal"; target: string; data: unknown }
  | { type: "sharing"; sharing: boolean };

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(
  roomId: string,
  message: unknown,
  excludedPeerId?: string,
): void {
  for (const client of findRoom(roomId)?.values() ?? []) {
    if (client.id !== excludedPeerId) send(client.socket, message);
  }
}

function parseMessage(raw: Buffer | ArrayBuffer | Buffer[]): ClientMessage | null {
  try {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;

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

    return null;
  } catch {
    return null;
  }
}

export async function registerSignaling(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, (socket) => {
    let membership: Membership | undefined;

    const leaveRoom = () => {
      if (!membership) return;

      const { roomId, client } = membership;
      removeClient(roomId, client.id);
      broadcast(roomId, { type: "peer-left", peerId: client.id });
      membership = undefined;
    };

    socket.on("message", (raw) => {
      const message = parseMessage(raw);
      if (!message) {
        send(socket, { type: "error", message: "Invalid message." });
        return;
      }

      if (message.type === "join") {
        const roomId = message.room?.trim();
        const name = message.name?.trim();

        if (!roomId || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) {
          send(socket, { type: "error", message: "Invalid room ID." });
          return;
        }

        if (!name || name.length > 32) {
          send(socket, { type: "error", message: "Enter a name up to 32 characters." });
          return;
        }

        leaveRoom();
        const room = getRoom(roomId);
        const client: Client = {
          id: randomUUID(),
          name,
          sharing: false,
          socket,
        };

        const peers = [...room.values()].map(toPeer);
        room.set(client.id, client);
        membership = { roomId, client };

        send(socket, { type: "room-state", selfId: client.id, peers });
        broadcast(
          roomId,
          { type: "peer-joined", peer: toPeer(client) },
          client.id,
        );
        return;
      }

      if (!membership) {
        send(socket, { type: "error", message: "Join a room first." });
        return;
      }

      const { roomId, client } = membership;
      const room = getRoom(roomId);

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
        if (typeof message.sharing !== "boolean") return;

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
        broadcast(
          roomId,
          { type: "peer-updated", peer: toPeer(client) },
          client.id,
        );
      }
    });

    socket.on("close", leaveRoom);
    socket.on("error", leaveRoom);
  });
}
