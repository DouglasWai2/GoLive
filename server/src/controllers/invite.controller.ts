import type { FastifyInstance } from "fastify";
import type { FastifyRequest, FastifyReply } from "fastify";
import { RoomService } from "../services/room.service.js";
import { isInviteToken, type RoomToken } from "../types/room.js";
import { CatalogError, type CatalogService } from "../services/catalog.service.js";
import { issueRoomSession } from "../services/access.service.js";

const INVITE_TTL_SECONDS = 24 * 60 * 60;
const ROOM_SESSION_TTL_SECONDS = 8 * 60 * 60;

type CreateInviteBody = {
  roomId: string;
};

type VerifyInviteBody = {
  roomId: string;
  name: string;
  inviteToken: string;
  deviceToken?: string;
};

export function createInviteController(roomService: RoomService, app: FastifyInstance, catalog?: CatalogService) {
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

      if (catalog) {
        if (!user.userId || !await catalog.isMember(user.userId, roomId)) {
          return reply.code(403).send({ error: "Room access revoked." });
        }
        const generation = await catalog.getGeneration(roomId);
        if (!generation) return reply.code(404).send({ error: "Room not found." });
        const inviteToken = app.jwt.sign({ kind: "invite", roomId, generation }, { expiresIn: INVITE_TTL_SECONDS });
        return reply.header("Cache-Control", "no-store").send({ inviteToken });
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
      const { roomId, name, inviteToken, deviceToken } = request.body as VerifyInviteBody;

      if (!name.trim()) return reply.code(400).send({ error: "Name is required" });

      let invite: Record<string, unknown>;
      try {
        invite = app.jwt.verify<Record<string, unknown>>(inviteToken);
      } catch {
        return reply.code(401).send({ error: "Invalid or expired invite." });
      }

      if (!isInviteToken(invite) || invite.roomId !== roomId) {
        return reply.code(403).send({ error: "Invite does not match this room." });
      }

      if (catalog) {
        if (!invite.generation) return reply.code(403).send({ error: "Invite does not match this room." });
        try {
          const enrolled = await catalog.joinByInvite(roomId, invite.generation, name, deviceToken);
          if (enrolled.previousRoomId && enrolled.previousRoomId !== roomId) {
            roomService.disconnectUser(enrolled.userId);
            if (!await catalog.hasMembers(enrolled.previousRoomId)) roomService.invalidateRoom(enrolled.previousRoomId);
          }
          return reply.header("Cache-Control", "no-store").send({
            ...issueRoomSession(app, roomService, enrolled),
            deviceToken: enrolled.deviceToken,
          });
        } catch (error) {
          if (error instanceof CatalogError) return reply.code(error.status).send({ error: error.message });
          throw error;
        }
      }
      if (!invite.roomInstanceId || !roomService.isCurrentRoomInstance(invite.roomId, invite.roomInstanceId)) {
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
