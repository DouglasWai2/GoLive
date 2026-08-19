import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { registerErrorHandler } from "./middlewares/error-handler.js";
import { registerRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });

  await app.register(cors, {
    origin: env.origin,
  });

  registerErrorHandler(app);
  registerRoutes(app);

  return app;
}