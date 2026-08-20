import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { env } from "./config/env.js";
import { registerErrorHandler } from "./middlewares/error-handler.js";
import { registerRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(websocket, {
    options: {
      maxPayload: 128 * 1024,
      perMessageDeflate: false,
    },
  });
  await app.register(cors, {
    origin: env.origin,
  });

  await app.register(helmet);
  await app.register(jwt, {
    secret: env.jwtSecret ?? "insecure-dev-secret",
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  registerErrorHandler(app);
  registerRoutes(app);

  return app;
}