import { randomUUID } from "node:crypto";
import type { Client, Peer, RoomSession, RoomsSnapshot } from "../types/room.js";

export class RoomService {
  private readonly rooms = new Map<string, Map<string, Client>>();
  private readonly hosts = new Map<string, string>();
  private readonly roomInstances = new Map<string, string>();

  createRoomSession(roomId: string, name: string): RoomSession | undefined {
    if (this.hosts.has(roomId) || this.rooms.has(roomId)) return undefined;

    const roomInstanceId = randomUUID();
    const session = this.createSession(roomId, name, roomInstanceId);
    this.hosts.set(roomId, session.sessionId);
    this.roomInstances.set(roomId, roomInstanceId);
    return session;
  }

  isReserved(roomId: string): boolean {
    return this.hosts.has(roomId) || this.rooms.has(roomId);
  }

  getOrCreateInstance(roomId: string): string {
    let instance = this.roomInstances.get(roomId);
    if (!instance) {
      instance = randomUUID();
      this.roomInstances.set(roomId, instance);
    }
    return instance;
  }

  disconnectUser(userId: string): void {
    for (const room of this.rooms.values()) {
      for (const client of room.values()) {
        if (client.userId === userId) client.socket.close(4003, "Room access revoked");
      }
    }
  }

  invalidateRoom(roomId: string): void {
    for (const client of this.rooms.get(roomId)?.values() ?? []) {
      client.socket.close(4003, "Room deleted");
    }
    this.rooms.delete(roomId);
    this.hosts.delete(roomId);
    this.roomInstances.delete(roomId);
  }

  isCurrentRoomInstance(roomId: string, roomInstanceId: string): boolean {
    return this.roomInstances.get(roomId) === roomInstanceId;
  }

  createSession(roomId: string, name: string, roomInstanceId: string): RoomSession {
    const session: RoomSession = {
      kind: "room",
      sessionId: randomUUID(),
      roomId,
      roomInstanceId,
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
      this.roomInstances.delete(roomId);
      return;
    }
  }

  getSnapshot(): RoomsSnapshot {
    let activeUsers = 0;
    let activeSharers = 0;
    const rooms = [...this.rooms.entries()]
      .filter(([, clients]) => clients.size > 0)
      .map(([id, clients]) => {
        const participants = [...clients.values()].map((client) => ({
          id: client.id,
          name: client.name,
          sharing: client.sharing,
          connectedAt: client.connectedAt,
        }));
        const roomSharers = participants.filter(
          (participant) => participant.sharing,
        ).length;

        activeUsers += participants.length;
        activeSharers += roomSharers;

        return {
          id,
          startedAt: participants.reduce(
            (oldest, participant) => participant.connectedAt < oldest
              ? participant.connectedAt
              : oldest,
            participants[0]!.connectedAt,
          ),
          activeUsers: participants.length,
          activeSharers: roomSharers,
          participants,
        };
      });

    return {
      activeRooms: rooms.length,
      activeUsers,
      activeSharers,
      rooms,
    };
  }

  toPeer(client: Client): Peer {
    return {
      id: client.id,
      name: client.name,
      sharing: client.sharing,
    };
  }
}
