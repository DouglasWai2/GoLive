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