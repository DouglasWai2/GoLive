import { randomUUID } from "node:crypto";
import type { Client, Peer, RoomSession } from "../types/room.js";

export class RoomService {
  private readonly rooms = new Map<string, Map<string, Client>>();
  private readonly hosts = new Map<string, string>();

  hasHost(roomId: string): boolean {
    return this.hosts.has(roomId);
  }

  claimHost(roomId: string, sessionId: string): boolean {
    if (this.hosts.has(roomId)) return false;

    this.hosts.set(roomId, sessionId);
    return true;
  }

  createSession(roomId: string, name: string): RoomSession {
    const session: RoomSession = {
      kind: "room",
      sessionId: randomUUID(),
      roomId,
      name: name.trim(),
    };

    return session;
  }

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

  getClient(roomId: string, peerId: string): Client | undefined {
    return this.rooms.get(roomId)?.get(peerId);
  }

  removeClient(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.delete(peerId);
    if (room.size === 0) {
      this.rooms.delete(roomId);
      this.hosts.delete(roomId);
    }
  }

  toPeer(client: Client): Peer {
    return {
      id: client.id,
      name: client.name,
      sharing: client.sharing,
    };
  }
}