import type { Client, Peer } from "../types/room.js";

export class RoomService {
  private readonly rooms = new Map<string, Map<string, Client>>();

  getRoom(roomId: string): Map<string, Client> {
    let room = this.rooms.get(roomId);

    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }

    return room;
  }

  findRoom(roomId: string): Map<string, Client> | undefined {
    return this.rooms.get(roomId);
  }

  removeClient(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.delete(peerId);
    if (room.size === 0) this.rooms.delete(roomId);
  }

  toPeer(client: Client): Peer {
    return {
      id: client.id,
      name: client.name,
      sharing: client.sharing,
    };
  }
}