import type { FastifyInstance } from "fastify";
import { normalizeIP } from "@fastify/rate-limit";
import { createRoomController } from "../controllers/room.controller.js";
import { RoomService } from "../services/room.service.js";
import { ROOM_ID_PATTERN } from "../utils/room-id.js";
import { DISPLAY_NAME_PATTERN, DEVICE_TOKEN_LENGTH } from "../utils/validation.js";
import type { CatalogService } from "../services/catalog.service.js";

const DAILY_ROOM_CREATION_LIMIT = 20;

export function registerRoomRoutes(
  app: FastifyInstance,
  roomService: RoomService,
  catalog?: CatalogService,
): void {
  const controller = createRoomController(roomService, app, catalog);
  const dailyCreationLimit = app.createRateLimit({
    max: DAILY_ROOM_CREATION_LIMIT,
    timeWindow: "1 day",
    keyGenerator: (request) => `room-create:${normalizeIP(request.ip)}`,
  });

  app.post(
    "/room",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      preHandler: async (request, reply) => {
        const result = await dailyCreationLimit(request);
        if (result.isAllowed || !result.isExceeded) return;
        return reply
          .code(429)
          .header("Retry-After", String(result.ttlInSeconds))
          .send({ error: "Daily room creation limit exceeded" });
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
            name: {
              type: "string",
              minLength: 1,
              maxLength: 32,
              pattern: DISPLAY_NAME_PATTERN,
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
    controller,
  );
}
