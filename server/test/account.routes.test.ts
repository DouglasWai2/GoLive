import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { registerDeviceRoutes } from "../src/routes/device.routes.js";
import { RoomService } from "../src/services/room.service.js";
import type { CatalogService } from "../src/services/catalog.service.js";

test("account rooms use account authentication without a device credential", async () => {
  const app = Fastify();
  const ended: string[] = [];
  const catalog = {
    listOwnedRooms: async (userId: string) => userId === "owner" ? [{ id: "ownedroom1", name: "Owned room", owner: true }] : [],
    endOwnedRoom: async (userId: string, roomId: string) => {
      if (userId !== "owner" || roomId !== "ownedroom1") return false;
      ended.push(roomId);
      return true;
    },
  } as unknown as CatalogService;
  registerDeviceRoutes(app, new RoomService(), catalog, undefined,
    async (token) => token === "account-one" ? { id: "owner" } : token === "account-two" ? { id: "other" } : null);

  try {
    const unauthenticated = await app.inject({ method: "GET", url: "/account/rooms" });
    assert.equal(unauthenticated.statusCode, 401);
    const invalid = await app.inject({ method: "GET", url: "/account/rooms", headers: { authorization: "Bearer invalid" } });
    assert.equal(invalid.statusCode, 401);
    const rooms = await app.inject({ method: "GET", url: "/account/rooms", headers: { authorization: "Bearer account-one" } });
    assert.equal(rooms.statusCode, 200);
    assert.equal(rooms.headers["cache-control"], "no-store");
    assert.deepEqual(rooms.json().rooms.map((room: { id: string }) => room.id), ["ownedroom1"]);
    const unrelated = await app.inject({ method: "GET", url: "/account/rooms", headers: { authorization: "Bearer account-two" } });
    assert.deepEqual(unrelated.json().rooms, []);
    const denied = await app.inject({ method: "DELETE", url: "/account/rooms/ownedroom1", headers: { authorization: "Bearer account-two" } });
    assert.equal(denied.statusCode, 404);
    const malformed = await app.inject({ method: "DELETE", url: "/account/rooms/bad%20id", headers: { authorization: "Bearer account-one" } });
    assert.equal(malformed.statusCode, 400);
    const deleted = await app.inject({ method: "DELETE", url: "/account/rooms/ownedroom1", headers: { authorization: "Bearer account-one" } });
    assert.equal(deleted.statusCode, 204);
    assert.deepEqual(ended, ["ownedroom1"]);
  } finally {
    await app.close();
  }
});
