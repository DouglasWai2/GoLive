import { randomUUID } from "node:crypto";
import type { Client, Peer, RoomSession, RoomsSnapshot } from "../types/room.js";

export class RoomService {
  private readonly rooms = new Map<string, Map<string, Client>>();
  private readonly hosts = new Map<string, string>();
  private readonly roomInstances = new Map<string, string>();
  private readonly heartbeatOwners = new Map<string, string>();

  createRoomSession(roomId: string, name: string): RoomSession | undefined {
    if (this.hosts.has(roomId) || this.rooms.has(roomId)) return undefined;

    const roomInstanceId = randomUUID();
    const session = this.createSession(roomId, name, roomInstanceId);
    this.hosts.set(roomId, session.sessionId);
    this.roomInstances.set(roomId, roomInstanceId);
    return session;
  }

  isHost(roomId: string, sessionId: string): boolean {
    return this.hosts.get(roomId) === sessionId;
  }

  isCurrentRoomInstance(roomId: string, roomInstanceId: string): boolean {
    return this.roomInstances.get(roomId) === roomInstanceId;
  }

  getHeartbeatOwner(roomId: string): string | undefined {
    return this.heartbeatOwners.get(roomId);
  }

  refreshHeartbeatOwner(roomId: string): string | undefined {
    const room = this.rooms.get(roomId);

    if (!room?.size) {
      this.heartbeatOwners.delete(roomId);
      return undefined;
    }

    const currentOwnerId = this.heartbeatOwners.get(roomId);
    const hostId = this.hosts.get(roomId);
    const ownerId = currentOwnerId && room.has(currentOwnerId)
      ? currentOwnerId
      : hostId && room.has(hostId)
        ? hostId
        : room.keys().next().value as string;

    this.heartbeatOwners.set(roomId, ownerId);
    return ownerId;
  }

  reclaimHostHeartbeat(roomId: string, sessionId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room?.has(sessionId) || !this.isHost(roomId, sessionId)) {
      return this.refreshHeartbeatOwner(roomId);
    }

    this.heartbeatOwners.set(roomId, sessionId);
    return sessionId;
  }

  rotateHeartbeatOwner(roomId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room?.size) {
      this.heartbeatOwners.delete(roomId);
      return undefined;
    }

    const peerIds = [...room.keys()];
    const currentOwnerId = this.heartbeatOwners.get(roomId);
    const currentIndex = currentOwnerId ? peerIds.indexOf(currentOwnerId) : -1;
    const ownerId = peerIds[(currentIndex + 1) % peerIds.length]!;

    this.heartbeatOwners.set(roomId, ownerId);
    return ownerId;
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
      this.heartbeatOwners.delete(roomId);
      return;
    }

    this.refreshHeartbeatOwner(roomId);
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
