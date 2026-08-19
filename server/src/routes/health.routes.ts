import type { FastifyInstance } from "fastify";
import { healthHandler } from "../controllers/health.controller.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", healthHandler);
}