import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { CatalogError, CatalogService } from "../src/services/catalog.service.js";

const id = () => `auth_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

type TestRequestOptions = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  payload?: object | string;
};

test("enforces account room quotas and keeps guest profiles to one room grant", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const original = {
    DATABASE_URL: process.env.DATABASE_URL,
    TRUST_PROXY: process.env.TRUST_PROXY,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED,
  };
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.TRUST_PROXY = "1";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.JWT_SECRET = "test-jwt-secret-with-enough-entropy";
  process.env.GOOGLE_AUTH_ENABLED = "true";

  const accountUserId = randomUUID();
  const otherUserId = randomUUID();
  const authRoomIds: string[] = [];
  const guestRoomIds: string[] = [];
  const profileIds: string[] = [];
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const verifyNeonAuth = async (token: string) => {
    if (token === "account-one") return { id: accountUserId };
    if (token === "account-two") return { id: otherUserId };
    return null;
  };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let testIpSuffix = 1;
  const inject = (options: TestRequestOptions) => app!.inject({
    ...options,
    headers: {
      ...options.headers,
      "x-forwarded-for": `198.18.2.${testIpSuffix++}`,
    },
  });

  try {
    app = await buildApp({ verifyNeonAuth });

    const accountRooms: Array<{ id: string; token: string }> = [];
    let ownerDeviceToken: string | undefined;
    for (let index = 0; index < 4; index += 1) {
      const roomId = id();
      authRoomIds.push(roomId);
      const response = await inject({
        method: "POST",
        url: "/room",
        headers: { authorization: "Bearer account-one" },
        payload: { roomId, name: "Account owner", deviceToken: ownerDeviceToken },
      });
      assert.equal(response.statusCode, 200, response.body);
      const room = response.json<{ deviceToken: string; token: string; session: { userId: string } }>();
      ownerDeviceToken ??= room.deviceToken;
      accountRooms.push({ id: roomId, token: room.deviceToken });
      profileIds.push(room.session.userId);
    }

    const concurrentIds = [id(), id()];
    authRoomIds.push(...concurrentIds);
    const concurrent = await Promise.allSettled(concurrentIds.map((roomId) =>
      new CatalogService(pool).createOwnedRoom(roomId, "Account owner", accountRooms[0]!.token, accountUserId),
    ));
    const successfulConcurrentCreate = concurrent.find((result) => result.status === "fulfilled");
    const rejectedConcurrentCreate = concurrent.find((result) => result.status === "rejected");
    assert.ok(successfulConcurrentCreate?.status === "fulfilled");
    assert.ok(rejectedConcurrentCreate?.status === "rejected");
    assert.ok(rejectedConcurrentCreate.reason instanceof CatalogError);
    assert.equal(rejectedConcurrentCreate.reason.status, 409);
    assert.equal(successfulConcurrentCreate.value.deviceToken, accountRooms[0]!.token);
    profileIds.push(successfulConcurrentCreate.value.userId);

    const sixthId = id();
    authRoomIds.push(sixthId);
    const sixth = await inject({
      method: "POST",
      url: "/room",
      headers: { authorization: "Bearer account-one" },
      payload: { roomId: sixthId, name: "Account owner", deviceToken: accountRooms[0]!.token },
    });
    assert.equal(sixth.statusCode, 409, sixth.body);

    const accountOnlyRooms = await inject({ method: "GET", url: "/account/rooms", headers: { authorization: "Bearer account-one" } });
    assert.equal(accountOnlyRooms.statusCode, 200, accountOnlyRooms.body);
    assert.equal(accountOnlyRooms.headers["cache-control"], "no-store");
    assert.deepEqual(new Set(accountOnlyRooms.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id)),
      new Set([...accountRooms.map((room) => room.id), successfulConcurrentCreate.value.roomId]));
    assert.equal((await inject({ method: "GET", url: "/account/rooms" })).statusCode, 401);
    assert.deepEqual((await inject({ method: "GET", url: "/account/rooms", headers: { authorization: "Bearer account-two" } })).json().rooms, []);

    const otherDevice = await inject({
      method: "POST", url: "/room", headers: { authorization: "Bearer account-one" },
      payload: { roomId: accountRooms[1]!.id, name: "Another device" },
    });
    assert.equal(otherDevice.statusCode, 200, otherDevice.body);
    const otherDeviceSession = otherDevice.json<{ deviceToken: string; session: { userId: string } }>();
    profileIds.push(otherDeviceSession.session.userId);
    assert.notEqual(otherDeviceSession.deviceToken, ownerDeviceToken);
    const otherDeviceRooms = await inject({ method: "GET", url: "/device/rooms", headers: {
      authorization: "Bearer account-one", "x-device-token": otherDeviceSession.deviceToken,
    } });
    assert.deepEqual(otherDeviceRooms.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id), [accountRooms[1]!.id]);
    assert.equal((await inject({ method: "POST", url: "/room", headers: { authorization: "Bearer account-two" },
      payload: { roomId: accountRooms[1]!.id, name: "Not the owner" } })).statusCode, 403);

    const authenticatedHeaders = {
      authorization: "Bearer account-one",
      "x-device-token": accountRooms[0]!.token,
    };
    const accountRoomList = await inject({ method: "GET", url: "/device/rooms", headers: authenticatedHeaders });
    assert.equal(accountRoomList.statusCode, 200, accountRoomList.body);
    assert.equal(accountRoomList.json<{ rooms: unknown[] }>().rooms.length, 5);

    const guestView = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: `Bearer ${accountRooms[0]!.token}` },
    });
    assert.equal(guestView.statusCode, 200, guestView.body);
    assert.equal(guestView.json<{ rooms: unknown[] }>().rooms.length, 0);

    const wrongAccount = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: "Bearer account-two", "x-device-token": accountRooms[0]!.token },
    });
    assert.equal(wrongAccount.statusCode, 403);

    await app!.close();
    app = await buildApp({ verifyNeonAuth });

    const signedOutGuestRoomId = id();
    guestRoomIds.push(signedOutGuestRoomId);
    const signedOutGuestRoom = await inject({
      method: "POST",
      url: "/room",
      payload: { roomId: signedOutGuestRoomId, name: "Guest after sign-out", deviceToken: accountRooms[0]!.token },
    });
    assert.equal(signedOutGuestRoom.statusCode, 200, signedOutGuestRoom.body);
    const guestRoomOwner = await pool.query<{ owner_auth_user_id: string | null }>(
      "SELECT owner_auth_user_id FROM rooms WHERE id = $1", [signedOutGuestRoomId],
    );
    assert.equal(guestRoomOwner.rows[0]?.owner_auth_user_id, null);
    const guestRoomHeaders = { authorization: `Bearer ${accountRooms[0]!.token}` };
    const visibleToGuest = await inject({ method: "GET", url: "/device/rooms", headers: guestRoomHeaders });
    assert.deepEqual(visibleToGuest.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id), [signedOutGuestRoomId]);
    const visibleAfterSignIn = await inject({ method: "GET", url: "/device/rooms", headers: authenticatedHeaders });
    const restoredRoomIds = visibleAfterSignIn.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id);
    assert.equal(restoredRoomIds.length, 5);
    assert.equal(restoredRoomIds.includes(signedOutGuestRoomId), false);
    assert.ok(restoredRoomIds.includes(successfulConcurrentCreate.value.roomId));

    await app!.close();
    app = await buildApp({ verifyNeonAuth });

    const guestRoomId = id();
    guestRoomIds.push(guestRoomId);
    const guestCreate = await inject({ method: "POST", url: "/room", payload: { roomId: guestRoomId, name: "Guest" } });
    assert.equal(guestCreate.statusCode, 200, guestCreate.body);
    const guest = guestCreate.json<{ deviceToken: string; session: { userId: string } }>();
    profileIds.push(guest.session.userId);

    const secondGuestRoomId = id();
    guestRoomIds.push(secondGuestRoomId);
    const secondGuestCreate = await inject({
      method: "POST",
      url: "/room",
      payload: { roomId: secondGuestRoomId, name: "Guest", deviceToken: guest.deviceToken },
    });
    assert.equal(secondGuestCreate.statusCode, 200, secondGuestCreate.body);
    assert.equal(secondGuestCreate.json<{ deviceToken: string }>().deviceToken, guest.deviceToken);
    const afterGuestCreate = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: `Bearer ${guest.deviceToken}` },
    });
    assert.deepEqual(afterGuestCreate.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id), [secondGuestRoomId]);

    const inviteOwnerRoomId = id();
    guestRoomIds.push(inviteOwnerRoomId);
    const inviteOwnerResponse = await inject({
      method: "POST",
      url: "/room",
      payload: { roomId: inviteOwnerRoomId, name: "Invite owner" },
    });
    const inviteOwner = inviteOwnerResponse.json<{ token: string; session: { userId: string } }>();
    profileIds.push(inviteOwner.session.userId);
    const invite = await inject({
      method: "POST",
      url: "/invite",
      headers: { authorization: `Bearer ${inviteOwner.token}` },
      payload: { roomId: inviteOwnerRoomId },
    });
    const inviteToken = invite.json<{ inviteToken: string }>().inviteToken;

    const switched = await inject({
      method: "POST",
      url: "/invite/verify",
      payload: { roomId: inviteOwnerRoomId, inviteToken, deviceToken: guest.deviceToken },
    });
    assert.equal(switched.statusCode, 200, switched.body);
    const switchedRooms = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: `Bearer ${guest.deviceToken}` },
    });
    assert.equal(switchedRooms.statusCode, 200, switchedRooms.body);
    assert.deepEqual(
      switchedRooms.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id),
      [inviteOwnerRoomId],
    );

    const guestThirdRoomId = id();
    guestRoomIds.push(guestThirdRoomId);
    const guestCreatedAgain = await inject({
      method: "POST",
      url: "/room",
      payload: { roomId: guestThirdRoomId, name: "Guest", deviceToken: guest.deviceToken },
    });
    assert.equal(guestCreatedAgain.statusCode, 200, guestCreatedAgain.body);
    const afterGuestSwitch = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: `Bearer ${guest.deviceToken}` },
    });
    assert.deepEqual(afterGuestSwitch.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id), [guestThirdRoomId]);

    await app!.close();
    app = await buildApp({ verifyNeonAuth });

    const authRoomToRemove = authRoomIds[0]!;
    const removed = await inject({
      method: "DELETE",
      url: `/device/rooms/${authRoomToRemove}`,
      headers: authenticatedHeaders,
    });
    assert.equal(removed.statusCode, 204);
    const afterRoomReleasedId = id();
    authRoomIds.push(afterRoomReleasedId);
    const afterRoomReleased = await inject({
      method: "POST",
      url: "/room",
      headers: authenticatedHeaders,
      payload: { roomId: afterRoomReleasedId, name: "Account owner", deviceToken: accountRooms[0]!.token },
    });
    assert.equal(afterRoomReleased.statusCode, 200, afterRoomReleased.body);
    const reopenEmptyAtQuota = await inject({ method: "POST", url: "/room", headers: { authorization: "Bearer account-one" },
      payload: { roomId: authRoomToRemove, name: "Account owner" } });
    assert.equal(reopenEmptyAtQuota.statusCode, 409);

    const guestOwnedRoomId = id();
    guestRoomIds.push(guestOwnedRoomId);
    const guestOwnedRoom = await inject({
      method: "POST",
      url: "/room",
      payload: { roomId: guestOwnedRoomId, name: "Created while signed out" },
    });
    assert.equal(guestOwnedRoom.statusCode, 200, guestOwnedRoom.body);
    const guestOwnedProfile = guestOwnedRoom.json<{ deviceToken: string; session: { userId: string } }>();
    profileIds.push(guestOwnedProfile.session.userId);

    const linkedGuestProfile = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: "Bearer account-one", "x-device-token": guestOwnedProfile.deviceToken },
    });
    assert.equal(linkedGuestProfile.statusCode, 200, linkedGuestProfile.body);
    assert.deepEqual(linkedGuestProfile.json<{ rooms: Array<{ id: string }> }>().rooms, []);
    const guestModeAfterLink = await inject({
      method: "GET",
      url: "/device/rooms",
      headers: { authorization: `Bearer ${guestOwnedProfile.deviceToken}` },
    });
    assert.deepEqual(guestModeAfterLink.json<{ rooms: Array<{ id: string }> }>().rooms.map((room) => room.id), [guestOwnedRoomId]);
    const linkedGuestRoomOwner = await pool.query<{ owner_auth_user_id: string | null }>(
      "SELECT owner_auth_user_id FROM rooms WHERE id = $1", [guestOwnedRoomId],
    );
    assert.equal(linkedGuestRoomOwner.rows[0]?.owner_auth_user_id, null);

    const overQuotaAfterLinking = await inject({
      method: "POST",
      url: "/room",
      headers: { authorization: "Bearer account-one" },
      payload: { roomId: id(), name: "Account owner", deviceToken: guestOwnedProfile.deviceToken },
    });
    assert.equal(overQuotaAfterLinking.statusCode, 409);

    const cannotEndOthersRoom = await inject({ method: "DELETE", url: `/account/rooms/${accountRooms[1]!.id}`,
      headers: { authorization: "Bearer account-two" } });
    assert.equal(cannotEndOthersRoom.statusCode, 404);
    const ended = await inject({ method: "DELETE", url: `/account/rooms/${accountRooms[1]!.id}`,
      headers: { authorization: "Bearer account-one" } });
    assert.equal(ended.statusCode, 204);
    assert.equal((await inject({ method: "GET", url: "/account/rooms", headers: { authorization: "Bearer account-one" } })).json().rooms.length, 4);
    assert.equal((await inject({ method: "POST", url: `/device/rooms/${accountRooms[1]!.id}/session`, headers: {
      authorization: "Bearer account-one", "x-device-token": otherDeviceSession.deviceToken,
    } })).statusCode, 404);
    const replacementId = id();
    authRoomIds.push(replacementId);
    const replacement = await inject({ method: "POST", url: "/room", headers: { authorization: "Bearer account-one" },
      payload: { roomId: replacementId, name: "New owner device" } });
    assert.equal(replacement.statusCode, 200, replacement.body);
    profileIds.push(replacement.json<{ session: { userId: string } }>().session.userId);
  } finally {
    if (app) await app.close();
    if (authRoomIds.length) await pool.query("DELETE FROM rooms WHERE id = ANY($1::varchar[])", [authRoomIds]);
    if (guestRoomIds.length) await pool.query("DELETE FROM rooms WHERE id = ANY($1::varchar[])", [guestRoomIds]);
    if (profileIds.length) await pool.query("DELETE FROM guest_profiles WHERE id = ANY($1::uuid[])", [profileIds]);
    await pool.end();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
