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
        return reply.send(data);
      } catch (error) {
        return handleTurnError(error, reply);
      }
    },
  };
}

function handleTurnError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof TurnServiceError) {
    return reply.code(error.status).send({ error: error.message });
  }

  reply.log.error(error);
  return reply.code(500).send({
    error: error instanceof Error ? error.message : "Unknown error",
  });
}