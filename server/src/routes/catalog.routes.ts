import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAdminConfigured } from "../controllers/admin.controller.js";
import type { CatalogService } from "../services/catalog.service.js";
import { RoomService } from "../services/room.service.js";
import { ROOM_ID_PATTERN } from "../utils/room-id.js";

const roomId = { type: "string", minLength: 8, maxLength: 64, pattern: ROOM_ID_PATTERN };
const profileId = { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" };
const roomName = { type: "string", minLength: 1, maxLength: 80 };
const guestName = { type: "string", minLength: 1, maxLength: 32 };
const body = (properties: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
});
const params = (id: object) => ({ type: "object", required: ["id"], properties: { id } });

export function registerCatalogRoutes(
  app: FastifyInstance,
  rooms: RoomService,
  catalog: CatalogService | undefined,
): void {
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAdminConfigured()) return reply.code(503).send({ error: "Admin unavailable" });
    try {
      await request.jwtVerify();
      if (!request.user || typeof request.user !== "object"
        || (request.user as Record<string, unknown>).kind !== "admin") {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (!catalog) return reply.code(503).send({ error: "Database unavailable" });
  };

  app.get("/admin/rooms", { preHandler: guard }, async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send({ rooms: await catalog!.listRooms() }));

  app.get("/admin/rooms/:id", { preHandler: guard, schema: { params: params(roomId) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await catalog!.getRoom(id);
    return found ? reply.header("Cache-Control", "no-store").send(found) : reply.code(404).send({ error: "Room not found" });
  });

  app.post("/admin/rooms", { preHandler: guard, schema: { body: body({ id: roomId, name: roomName }) } }, async (request, reply) => {
    const { id, name } = request.body as { id: string; name: string };
    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    const created = await catalog!.createRoom(id, name);
    return created ? reply.code(201).header("Cache-Control", "no-store").send(created)
      : reply.code(409).send({ error: "Room already exists" });
  });

  app.patch("/admin/rooms/:id", { preHandler: guard, schema: { params: params(roomId), body: body({ name: roomName }) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name: string };
    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    const updated = await catalog!.updateRoom(id, name);
    return updated ? reply.header("Cache-Control", "no-store").send(updated)
      : reply.code(404).send({ error: "Room not found" });
  });

  app.post("/admin/rooms/:id/invite", { preHandler: guard, schema: { params: params(roomId) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const generation = await catalog!.getGeneration(id);
    if (!generation) return reply.code(404).send({ error: "Room not found" });
    const inviteToken = app.jwt.sign({ kind: "invite", roomId: id, generation }, { expiresIn: 24 * 60 * 60 });
    return reply.header("Cache-Control", "no-store").send({ inviteToken });
  });

  app.delete("/admin/rooms/:id", { preHandler: guard, schema: { params: params(roomId) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (rooms.isReserved(id) || await catalog!.hasMembers(id)) return reply.code(409).send({ error: "Room has members or an active session" });
    const deleted = await catalog!.deleteRoom(id);
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: "Room not found" });
  });

  app.get("/admin/profiles", { preHandler: guard }, async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send({ profiles: await catalog!.listProfiles() }));

  app.get("/admin/profiles/:id", { preHandler: guard, schema: { params: params(profileId) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await catalog!.getProfile(id);
    return found ? reply.header("Cache-Control", "no-store").send(found) : reply.code(404).send({ error: "Profile not found" });
  });

  app.post("/admin/profiles", { preHandler: guard, schema: { body: body({ name: guestName }) } }, async (request, reply) => {
    const { name } = request.body as { name: string };
    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    return reply.code(201).header("Cache-Control", "no-store").send(await catalog!.createProfile(name));
  });

  app.patch("/admin/profiles/:id", { preHandler: guard, schema: { params: params(profileId), body: body({ name: guestName }) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name: string };
    if (!name.trim()) return reply.code(400).send({ error: "Name is required" });
    const updated = await catalog!.updateProfile(id, name);
    return updated ? reply.header("Cache-Control", "no-store").send(updated)
      : reply.code(404).send({ error: "Profile not found" });
  });

  app.delete("/admin/profiles/:id", { preHandler: guard, schema: { params: params(profileId) } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { deleted, roomId } = await catalog!.deleteProfile(id);
    if (deleted && roomId) {
      rooms.disconnectUser(id);
      if (!await catalog!.hasMembers(roomId)) rooms.invalidateRoom(roomId);
    }
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: "Profile not found" });
  });
}
