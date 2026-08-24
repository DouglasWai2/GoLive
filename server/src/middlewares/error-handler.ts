import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
      app.log.error(error);

      if (error.statusCode && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ error: error.message });
      }

      return reply.code(500).send({
        error: "Internal server error",
      });
    },
  );
}
