import type { FastifyInstance } from "fastify";
import { normalizeIP } from "@fastify/rate-limit";
import { createInviteController } from "../controllers/invite.controller.js";
import { RoomService } from "../services/room.service.js";
import { isRoomToken } from "../types/room.js";
import { ROOM_ID_PATTERN } from "../utils/room-id.js";
import { DISPLAY_NAME_PATTERN, DEVICE_TOKEN_LENGTH } from "../utils/validation.js";
import type { CatalogService } from "../services/catalog.service.js";

const DAILY_INVITE_VERIFICATION_LIMIT = 300;

export function registerInviteRoutes(
  app: FastifyInstance,
  roomService: RoomService,
  catalog?: CatalogService,
): void {
  const controller = createInviteController(roomService, app, catalog);
  const dailyVerificationLimit = app.createRateLimit({
    max: DAILY_INVITE_VERIFICATION_LIMIT,
    timeWindow: "1 day",
    keyGenerator: (request) => `invite-verify:${normalizeIP(request.ip)}`,
  });

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
              maxLength: 64,
              pattern: ROOM_ID_PATTERN,
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
      preHandler: async (request, reply) => {
        const result = await dailyVerificationLimit(request);
        if (result.isAllowed || !result.isExceeded) return;
        return reply
          .code(429)
          .header("Retry-After", String(result.ttlInSeconds))
          .send({ error: "Daily invite verification limit exceeded" });
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["roomId", "inviteToken"],
          properties: {
            roomId: {
              type: "string",
              minLength: 8,
              maxLength: 64,
              pattern: ROOM_ID_PATTERN,
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 32,
              pattern: DISPLAY_NAME_PATTERN,
            },
            inviteToken: {
              type: "string",
              minLength: 1,
              maxLength: 4096,
            },
            deviceToken: {
              type: "string",
              minLength: DEVICE_TOKEN_LENGTH,
              maxLength: DEVICE_TOKEN_LENGTH,
            },
          },
        },
      },
    },
    controller.verifyInvite,
  );
}
