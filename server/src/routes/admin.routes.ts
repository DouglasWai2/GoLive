import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createAdminController,
  isAdminConfigured,
} from "../controllers/admin.controller.js";
import { RoomService } from "../services/room.service.js";
import { SystemMetricsService } from "../services/system-metrics.service.js";
import { TurnService } from "../services/turn.service.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  if (!isAdminConfigured()) {
    return reply.code(503).send({ error: "Admin unavailable" });
  }

  try {
    await request.jwtVerify();
    if (
      !request.user
      || typeof request.user !== "object"
      || (request.user as Record<string, unknown>).kind !== "admin"
    ) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  roomService: RoomService,
  turnService: TurnService,
  systemMetrics: SystemMetricsService,
): void {
  const controller = createAdminController(
    app,
    roomService,
    turnService,
    systemMetrics,
  );

  app.post(
    "/admin/login",
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
          required: ["secret"],
          properties: {
            secret: { type: "string", minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    controller.login,
  );

  app.get(
    "/admin/overview",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      preHandler: requireAdmin,
    },
    controller.overview,
  );

  app.get(
    "/admin/turn-usage",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      preHandler: requireAdmin,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
      },
    },
    controller.turnUsage,
  );
}
