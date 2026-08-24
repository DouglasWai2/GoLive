import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { RoomService } from "../services/room.service.js";
import { SystemMetricsService } from "../services/system-metrics.service.js";
import { TurnService } from "../services/turn.service.js";
import { safeEqual } from "../utils/safeEqual.js";

const ADMIN_TOKEN_TTL_SECONDS = 60 * 60;
const MAX_USAGE_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

type AdminLoginBody = {
  secret: string;
};

type TurnUsageQuery = {
  from?: string;
  to?: string;
};

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || toDateString(date) !== value ? null : date;
}

export function isAdminConfigured(): boolean {
  return Boolean(env.adminSecret && env.jwtSecret);
}

export function createAdminController(
  app: FastifyInstance,
  roomService: RoomService,
  turnService: TurnService,
  systemMetrics: SystemMetricsService,
) {
  return {
    async login(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> {
      if (!isAdminConfigured()) {
        return reply.code(503).send({ error: "Admin unavailable" });
      }

      const { secret } = request.body as AdminLoginBody;
      if (!safeEqual(secret, env.adminSecret!)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const token = app.jwt.sign(
        { kind: "admin" },
        { expiresIn: ADMIN_TOKEN_TTL_SECONDS },
      );
      return reply.header("Cache-Control", "no-store").send({
        token,
        expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS,
      });
    },

    async overview(
      _request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> {
      const rooms = roomService.getSnapshot();
      const { generatedAt, serverStartedAt, ...system } =
        await systemMetrics.getSnapshot();

      return reply.header("Cache-Control", "no-store").send({
        generatedAt,
        serverStartedAt,
        scope: "process",
        summary: {
          activeRooms: rooms.activeRooms,
          activeUsers: rooms.activeUsers,
          activeSharers: rooms.activeSharers,
        },
        rooms: rooms.rooms,
        system,
      });
    },

    async turnUsage(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> {
      const today = new Date();
      const todayString = toDateString(today);
      const query = request.query as TurnUsageQuery;
      const fromString = query.from
        ?? `${todayString.slice(0, 8)}01`;
      const toString = query.to ?? todayString;
      const from = parseDate(fromString);
      const to = parseDate(toString);

      if (
        !from
        || !to
        || from > to
        || toString > todayString
        || ((to.getTime() - from.getTime()) / DAY_MS) + 1 > MAX_USAGE_RANGE_DAYS
      ) {
        return reply.code(400).send({ error: "Invalid date range" });
      }

      try {
        const result = await turnService.getCachedUsage(from, to);
        return reply.header("Cache-Control", "no-store").send(result);
      } catch (error) {
        request.log.error(error, "TURN usage request failed");
        return reply.code(502).send({ error: "TURN usage unavailable" });
      }
    },
  };
}
