import type { WebSocket } from "ws";

export type Peer = {
  id: string;
  name: string;
  sharing: boolean;
};

export type Client = Peer & {
  sessionId: string;
  socket: WebSocket;
  connectedAt: string;
};

export type RoomParticipantSnapshot = Readonly<Peer & {
  connectedAt: string;
}>;

export type ActiveRoomSnapshot = Readonly<{
  id: string;
  startedAt: string;
  activeUsers: number;
  activeSharers: number;
  participants: readonly RoomParticipantSnapshot[];
}>;

export type RoomsSnapshot = Readonly<{
  activeRooms: number;
  activeUsers: number;
  activeSharers: number;
  rooms: readonly ActiveRoomSnapshot[];
}>;

export type RoomSession = {
  kind: "room";
  sessionId: string;
  roomId: string;
  name: string;
};

export type RoomToken = {
  kind?: "room";
  sessionId: string;
  roomId: string;
  name: string;
  host?: boolean;
};

export type InviteToken = {
  kind: "invite";
  roomId: string;
};

export function isRoomToken(value: unknown): value is RoomToken {
  if (!value || typeof value !== "object") return false;

  const token = value as Record<string, unknown>;
  return (token.kind === undefined || token.kind === "room")
    && typeof token.sessionId === "string"
    && typeof token.roomId === "string"
    && typeof token.name === "string";
}
