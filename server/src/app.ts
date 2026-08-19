import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerSignaling } from "./signaling.js";

const app = Fastify({ logger: true });

await app.register(websocket, {
  options: { maxPayload: 1024 * 1024 },
});
await registerSignaling(app);

app.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
