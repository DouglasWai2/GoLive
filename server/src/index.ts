import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

dotenv.config();

const app = await buildApp();

try {
  await app.listen({ port: env.port, host: env.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

process.on("SIGTERM", () => {
  app.log.warn(
    "SIGTERM received - Render is stopping the instance",
  );
});

process.on("SIGINT", () => {
  app.log.warn("SIGINT received");
});

process.on("uncaughtException", (error) => {
  app.log.fatal(
    error,
    "Uncaught exception",
  );

  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  app.log.error(
    error,
    "Unhandled rejection",
  );
});