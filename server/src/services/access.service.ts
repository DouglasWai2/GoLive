import type { FastifyInstance } from "fastify";
import type { DeviceMembership } from "./catalog.service.js";
import { RoomService } from "./room.service.js";

export function issueRoomSession(app: FastifyInstance, rooms: RoomService, member: DeviceMembership) {
  const session = {
    kind: "room" as const,
    sessionId: member.userId,
    userId: member.userId,
    roomId: member.roomId,
    roomInstanceId: rooms.getOrCreateInstance(member.roomId),
    name: member.name,
  };
  const token = app.jwt.sign({ ...session, host: member.owner }, { expiresIn: 8 * 60 * 60 });
  return { session, token };
}
