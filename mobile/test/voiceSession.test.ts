import assert from "node:assert/strict";
import test from "node:test";
import {
  processVoiceSessionActions,
  shouldRetryVoiceSessionDrain,
} from "../src/utils/voiceSessionActions";
import {
  hasMicrophoneForegroundService,
  MICROPHONE_FOREGROUND_SERVICE_TYPE,
  orderVoiceSessionActions,
  resolveVoiceSessionRecovery,
  type VoiceSessionAction,
  type VoiceSessionStatus,
} from "../src/utils/voiceSession";

test("orders persisted notification actions by their native sequence", () => {
  const actions: VoiceSessionAction[] = [
    { id: "later", sequence: 9, sessionId: "call", action: "setDeafened", value: true },
    { id: "earlier", sequence: 3, sessionId: "call", action: "setMicMuted", value: false },
  ];

  assert.deepEqual(orderVoiceSessionActions(actions).map((action) => action.id), ["earlier", "later"]);
  assert.deepEqual(actions.map((action) => action.id), ["later", "earlier"]);
});

test("requires a running microphone FGS on API 30 and later", () => {
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: true,
    activeTypes: MICROPHONE_FOREGROUND_SERVICE_TYPE,
  }, 34), true);
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: true,
    projectionActive: true,
    activeTypes: 2,
  }, 34), false);
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: false,
  }, 34), false);
});

test("uses the legacy running-FGS signal before microphone type bits existed", () => {
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: true,
    activeTypes: 0,
  }, 29), true);
  assert.equal(hasMicrophoneForegroundService({
    running: false,
    sessionId: null,
    microphoneActive: true,
  }, 29), false);
});

test("reuses an active native session only when its room identity matches", () => {
  const active: VoiceSessionStatus = {
    running: true,
    sessionId: "native-session",
    roomLabel: "room-a",
    micMuted: true,
    deafened: true,
  };

  assert.deepEqual(resolveVoiceSessionRecovery(active, "room-a", "new-id"), {
    sessionId: "native-session",
    adoptExisting: true,
    stopSessionId: null,
    deafened: true,
  });
  assert.deepEqual(resolveVoiceSessionRecovery(active, "room-b", "new-id"), {
    sessionId: "new-id",
    adoptExisting: false,
    stopSessionId: "native-session",
    deafened: false,
  });
  assert.deepEqual(resolveVoiceSessionRecovery({ running: false, sessionId: null }, "room-a", "new-id"), {
    sessionId: "new-id",
    adoptExisting: false,
    stopSessionId: null,
    deafened: false,
  });
});

test("recovered same-room identity applies its pending action but never leaks it to another room", async () => {
  const active: VoiceSessionStatus = {
    running: true,
    sessionId: "native-session",
    roomLabel: "room-a",
    micMuted: true,
    deafened: true,
  };
  const pendingAction: VoiceSessionAction = {
    id: "deafen-toggle",
    sequence: 4,
    sessionId: "native-session",
    action: "setDeafened",
    value: false,
  };
  const sameRoom = resolveVoiceSessionRecovery(active, "room-a", "new-id");
  const applied: string[] = [];
  const sameRoomResult = await processVoiceSessionActions(
    [pendingAction],
    async (action) => {
      if (action.sessionId !== sameRoom.sessionId) return false;
      applied.push(action.id);
      return true;
    },
    async () => true,
  );
  assert.equal(sameRoom.deafened, true);
  assert.deepEqual(applied, [pendingAction.id]);
  assert.equal(sameRoomResult.processed, 1);

  const otherRoom = resolveVoiceSessionRecovery(active, "room-b", "fresh-session");
  const otherRoomResult = await processVoiceSessionActions(
    [pendingAction],
    async (action) => action.sessionId === otherRoom.sessionId,
    async () => true,
  );
  assert.equal(otherRoom.sessionId, "fresh-session");
  assert.equal(otherRoomResult.blocked, true);
  assert.equal(otherRoomResult.processed, 0);
  assert.equal(otherRoomResult.blockedActionId, pendingAction.id);
});

test("applies persisted actions in order and does not ACK a failed action", async () => {
  const applied: string[] = [];
  const acknowledged: string[] = [];
  const actions: VoiceSessionAction[] = [
    { id: "later", sequence: 2, sessionId: "call", action: "setDeafened", value: true },
    { id: "blocked", sequence: 1, sessionId: "call", action: "setMicMuted", value: false },
  ];

  const result = await processVoiceSessionActions(
    actions,
    async (action) => {
      applied.push(action.id);
      return action.id !== "blocked";
    },
    async (id) => {
      acknowledged.push(id);
      return true;
    },
  );

  assert.deepEqual(applied, ["blocked"]);
  assert.deepEqual(acknowledged, []);
  assert.deepEqual(result, {
    processed: 0,
    blocked: true,
    disconnected: false,
    blockedActionId: "blocked",
  });
});

test("denied notification Unmute does not immediately re-drain its failed capture", async () => {
  let drainCount = 0;
  let retryRequestedDuringDrain = false;
  let acknowledgeCount = 0;
  const result = await processVoiceSessionActions(
    [{ id: "unmute", sequence: 1, sessionId: "call", action: "setMicMuted", value: false }],
    async () => {
      drainCount += 1;
      // RoomSession emits microphone-request-finished before this failed action
      // pass unwinds; that callback requests another drain while one is active.
      retryRequestedDuringDrain = true;
      return false; // deterministic getUserMedia permission/capture denial
    },
    async () => {
      acknowledgeCount += 1;
      return true;
    },
  );

  assert.equal(result.blocked, true);
  assert.equal(acknowledgeCount, 0);
  assert.equal(shouldRetryVoiceSessionDrain(retryRequestedDuringDrain, result.blocked), false);
  assert.equal(drainCount, 1);
  // A later explicit event may retry the durable action; the failed attempt
  // itself cannot create a tight self-scheduling loop.
  assert.equal(shouldRetryVoiceSessionDrain(true, false), true);
});

test("ACKs only after a successful apply and stops after disconnect", async () => {
  const operations: string[] = [];
  const actions: VoiceSessionAction[] = [
    { id: "mute", sequence: 1, sessionId: "call", action: "setMicMuted", value: true },
    { id: "leave", sequence: 2, sessionId: "call", action: "disconnect" },
    { id: "deafen", sequence: 3, sessionId: "call", action: "setDeafened", value: true },
  ];

  const result = await processVoiceSessionActions(
    actions,
    async (action) => {
      operations.push(`apply:${action.id}`);
      return true;
    },
    async (id) => {
      operations.push(`ack:${id}`);
      return true;
    },
  );

  assert.deepEqual(operations, ["apply:mute", "ack:mute", "apply:leave", "ack:leave"]);
  assert.deepEqual(result, { processed: 2, blocked: false, disconnected: true });
});

test("reports disconnect after applying it even if persisting the ACK fails", async () => {
  const result = await processVoiceSessionActions(
    [{ id: "leave", sequence: 1, sessionId: "call", action: "disconnect" }],
    async () => true,
    async () => false,
  );

  assert.deepEqual(result, {
    processed: 1,
    blocked: true,
    disconnected: true,
    blockedActionId: "leave",
  });
});

test("ACKs a completed disconnect if applying it invalidates the room", async () => {
  let current = true;
  let acknowledged = false;
  const result = await processVoiceSessionActions(
    [{ id: "leave", sequence: 1, sessionId: "call", action: "disconnect" }],
    async () => {
      current = false;
      return true;
    },
    async () => {
      acknowledged = true;
      return true;
    },
    () => current,
  );

  assert.equal(acknowledged, true);
  assert.deepEqual(result, { processed: 1, blocked: false, disconnected: true });
});
