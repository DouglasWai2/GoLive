import type { FastifyInstance } from "fastify";
import type { FastifyRequest, FastifyReply } from "fastify";
import { RoomService } from "../services/room.service.js";
import { isInviteToken, type RoomToken } from "../types/room.js";

const INVITE_TTL_SECONDS = 24 * 60 * 60;
const ROOM_SESSION_TTL_SECONDS = 8 * 60 * 60;

type CreateInviteBody = {
  roomId: string;
};

type VerifyInviteBody = {
  roomId: string;
  name: string;
  inviteToken: string;
};

export function createInviteController(roomService: RoomService, app: FastifyInstance) {
  return {
    async createInvite(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> {
      const { roomId } = request.body as CreateInviteBody;
      const user = request.user as RoomToken;

      if (
        user.roomId !== roomId
        || !roomService.isCurrentRoomInstance(roomId, user.roomInstanceId)
      ) {
        return reply.code(403).send({ error: "Session does not match this room." });
      }

      const inviteToken = app.jwt.sign(
        { kind: "invite", roomId, roomInstanceId: user.roomInstanceId },
        { expiresIn: INVITE_TTL_SECONDS },
      );

      return reply.send({ inviteToken });
    },

    async verifyInvite(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> {
      const { roomId, name, inviteToken } = request.body as VerifyInviteBody;

      let invite: Record<string, unknown>;
      try {
        invite = app.jwt.verify<Record<string, unknown>>(inviteToken);
      } catch {
        return reply.code(401).send({ error: "Invalid or expired invite." });
      }

      if (
        !isInviteToken(invite)
        || invite.roomId !== roomId
        || !roomService.isCurrentRoomInstance(invite.roomId, invite.roomInstanceId)
      ) {
        return reply.code(403).send({ error: "Invite does not match this room." });
      }

      const session = roomService.createSession(
        invite.roomId,
        name,
        invite.roomInstanceId,
      );

      const token = app.jwt.sign(
        { ...session, host: false },
        { expiresIn: ROOM_SESSION_TTL_SECONDS },
      );

      return reply.send({ session, token });
    },
  };
}
