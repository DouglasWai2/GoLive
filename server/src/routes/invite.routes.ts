import type { FastifyInstance } from "fastify";
import { createInviteController } from "../controllers/invite.controller.js";
import { RoomService } from "../services/room.service.js";
import { isRoomToken } from "../types/room.js";

export function registerInviteRoutes(
  app: FastifyInstance,
  roomService: RoomService,
): void {
  const controller = createInviteController(roomService, app);

  app.post(
    "/invite",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      preHandler: async (request, reply) => {
        try {
          await request.jwtVerify();
          if (!isRoomToken(request.user)) {
            return reply.code(401).send({ error: "Unauthorized" });
          }
        } catch {
          return reply.code(401).send({ error: "Unauthorized" });
        }
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["roomId"],
          properties: {
            roomId: {
              type: "string",
              minLength: 8,
              maxLength: 128,
            },
          },
        },
      },
    },
    controller.createInvite,
  );

  app.post(
    "/invite/verify",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["roomId", "name", "inviteToken"],
          properties: {
            roomId: {
              type: "string",
              minLength: 8,
              maxLength: 128,
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 32,
            },
            inviteToken: {
              type: "string",
            },
          },
        },
      },
    },
    controller.verifyInvite,
  );
}
