import type { FastifyReply, FastifyRequest } from "fastify";

export async function healthHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  return reply.send({ status: "ok" });
}