import type { WebSocket } from "ws";
import { isValidRoomId } from "../utils/room-id.js";

export type Peer = {
  id: string;
  name: string;
  sharing: boolean;
  voiceJoined: boolean;
  micMuted: boolean;
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
  roomInstanceId: string;
  name: string;
};

export type RoomToken = RoomSession & {
  host: boolean;
};

export type InviteToken = {
  kind: "invite";
  roomId: string;
  roomInstanceId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRoomToken(value: unknown): value is RoomToken {
  if (!value || typeof value !== "object") return false;

  const token = value as Record<string, unknown>;
  return token.kind === "room"
    && typeof token.sessionId === "string"
    && UUID_PATTERN.test(token.sessionId)
    && typeof token.roomId === "string"
    && isValidRoomId(token.roomId)
    && typeof token.roomInstanceId === "string"
    && UUID_PATTERN.test(token.roomInstanceId)
    && typeof token.name === "string"
    && token.name.length > 0
    && token.name.length <= 32
    && token.name === token.name.trim()
    && typeof token.host === "boolean";
}

export function isInviteToken(value: unknown): value is InviteToken {
  if (!value || typeof value !== "object") return false;

  const token = value as Record<string, unknown>;
  return token.kind === "invite"
    && typeof token.roomId === "string"
    && isValidRoomId(token.roomId)
    && typeof token.roomInstanceId === "string"
    && UUID_PATTERN.test(token.roomInstanceId);
}
