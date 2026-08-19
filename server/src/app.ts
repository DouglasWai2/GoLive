import websocket from "@fastify/websocket";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerSignaling } from "./signaling.js";
import dotenv from "dotenv";

dotenv.config();


const app = Fastify({ logger: true });

await app.register(websocket, {
  options: { maxPayload: 1024 * 1024 },
});
await app.register(cors, {
  origin: 'https://go-live-web.vercel.app',
});
await registerSignaling(app);

app.get("/health", async () => ({ status: "ok" }));

app.get("/turn-credentials", async (_request, reply) => {
  const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const turnApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

  if (!turnKeyId || !turnApiToken) {
    return reply.code(500).send({
      error: "TURN configuration missing",
    });
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${turnApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl: 86400,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();

    fastify.log.error(
      {
        status: response.status,
        error,
      },
      "Failed to generate TURN credentials",
    );

    return reply.code(502).send({
      error: "Failed to generate TURN credentials",
    });
  }

  const data = await response.json();

  return data;
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
