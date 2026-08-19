import type { WebSocket } from "ws";

export type Peer = {
  id: string;
  name: string;
  sharing: boolean;
};

export type Client = Peer & {
  socket: WebSocket;
};

const rooms = new Map<string, Map<string, Client>>();

export function getRoom(roomId: string): Map<string, Client> {
  let room = rooms.get(roomId);

  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }

  return room;
}

export function findRoom(roomId: string): Map<string, Client> | undefined {
  return rooms.get(roomId);
}

export function removeClient(roomId: string, peerId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.delete(peerId);
  if (room.size === 0) rooms.delete(roomId);
}

export function toPeer(client: Client): Peer {
  return {
    id: client.id,
    name: client.name,
    sharing: client.sharing,
  };
}
