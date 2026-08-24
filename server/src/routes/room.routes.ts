import type { FastifyInstance } from "fastify";
import { createRoomController } from "../controllers/room.controller.js";
import { RoomService } from "../services/room.service.js";
import { ROOM_ID_PATTERN } from "../utils/room-id.js";

export function registerRoomRoutes(
  app: FastifyInstance,
  roomService: RoomService,
): void {
  const controller = createRoomController(roomService, app);

  app.post(
    "/room",
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
          required: ["roomId", "name"],
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
            },
          },
        },
      },
    },
    controller,
  );
}
