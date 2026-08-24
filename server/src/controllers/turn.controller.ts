import type { FastifyReply, FastifyRequest } from "fastify";
import { TurnService, TurnServiceError } from "../services/turn.service.js";

export function createTurnController(turnService: TurnService) {
  return {
    async getTurnCredentials(
      _request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> {
      try {
        const data = await turnService.generateIceServers();
        return reply.header("Cache-Control", "no-store").send(data);
      } catch (error) {
        return handleTurnError(error, reply);
      }
    },
  };
}

function handleTurnError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof TurnServiceError) {
    return reply.code(error.status).send({
      code: error.code,
      error: error.message,
    });
  }

  reply.log.error(error);
  return reply.code(500).send({
    code: "TURN_ERROR",
    error: "TURN relay request failed",
  });
}
