import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: Error, _request: FastifyRequest, reply: FastifyReply) => {
      app.log.error(error);

      return reply.code(500).send({
        error: error.message || "Internal server error",
      });
    },
  );
}