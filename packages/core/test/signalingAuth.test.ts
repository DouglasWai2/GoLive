import assert from "node:assert/strict";
import { test } from "node:test";
import { joinRoom, listDeviceRooms, verifyInvite } from "../src/signaling";

test("room and device requests carry Neon and device credentials separately", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; headers: Headers; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      path: new URL(String(input)).pathname,
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    return new Response(JSON.stringify({ rooms: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await joinRoom("https://api.example.com", "auth_room_1", "Owner", "device-secret", "neon-jwt");
    await listDeviceRooms("https://api.example.com", "device-secret", "neon-jwt");

    assert.equal(requests[0]?.headers.get("authorization"), "Bearer neon-jwt");
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
      roomId: "auth_room_1",
      name: "Owner",
      deviceToken: "device-secret",
    });
    assert.equal(requests[1]?.path, "/device/rooms");
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer neon-jwt");
    assert.equal(requests[1]?.headers.get("x-device-token"), "device-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guest room requests do not send an account token", async () => {
  const originalFetch = globalThis.fetch;
  let authorization: string | null = null;
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ token: "room-jwt", session: {} }), { status: 200 });
  };

  try {
    await joinRoom("https://api.example.com", "guest_room_1", "Guest", undefined);
    assert.equal(authorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries room creation with a new device profile when the stored credential is stale", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ headers: Headers; body?: string }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: "Invalid device credential" }), { status: 401 });
    }
    return new Response(JSON.stringify({ token: "room-jwt", session: {}, deviceToken: "new-device-token" }), { status: 200 });
  };

  try {
    const result = await joinRoom("https://api.example.com", "guest_room_2", "Guest", "stale-device-token", "neon-jwt");
    assert.equal(result.deviceToken, "new-device-token");
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
      roomId: "guest_room_2",
      name: "Guest",
      deviceToken: "stale-device-token",
    });
    assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
      roomId: "guest_room_2",
      name: "Guest",
    });
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer neon-jwt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries invite acceptance with a new device profile when the stored credential is stale", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ headers: Headers; body?: string }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: "Invalid device credential" }), { status: 401 });
    }
    return new Response(JSON.stringify({ token: "room-jwt", session: {}, deviceToken: "new-device-token" }), { status: 200 });
  };

  try {
    const result = await verifyInvite(
      "https://api.example.com", "guest_room_3", "Guest", "invite-jwt", "stale-device-token", "neon-jwt",
    );
    assert.equal(result.deviceToken, "new-device-token");
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
      roomId: "guest_room_3",
      name: "Guest",
      inviteToken: "invite-jwt",
    });
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer neon-jwt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
