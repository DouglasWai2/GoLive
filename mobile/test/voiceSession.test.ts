import assert from "node:assert/strict";
import test from "node:test";
import {
  callBooleanBridgeWithTimeout,
  consumeUnmuteClaimOnce,
  createUnmuteClaimResetBarrier,
  processVoiceSessionActions,
  shouldRetryVoiceSessionDrain,
  VoiceSessionUnmuteAttemptGuard,
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

test("microphone FGS eligibility survives mute independently of track state", () => {
  const repeatedBackgroundToggleStates = [
    { microphoneActive: true, micMuted: false, projectionActive: false },
    { microphoneActive: false, micMuted: true, projectionActive: false },
    { microphoneActive: true, micMuted: false, projectionActive: true },
    { microphoneActive: false, micMuted: true, projectionActive: true },
  ];
  for (const state of repeatedBackgroundToggleStates) {
    assert.equal(hasMicrophoneForegroundService({
      running: true,
      sessionId: "call",
      ...state,
      activeTypes: MICROPHONE_FOREGROUND_SERVICE_TYPE | 2,
    }, 34), true);
  }

  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: false,
    micMuted: true,
    activeTypes: MICROPHONE_FOREGROUND_SERVICE_TYPE | 2,
  }, 34), true);
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: false,
    projectionActive: true,
    activeTypes: MICROPHONE_FOREGROUND_SERVICE_TYPE | 2,
  }, 34), true);
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: false,
    microphoneFgsActive: false,
    activeTypes: 2,
  }, 34), false);
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: true,
    activeTypes: 2,
  }, 34), false);
});

test("uses the legacy running-FGS signal before microphone type bits existed", () => {
  assert.equal(hasMicrophoneForegroundService({
    running: true,
    sessionId: "call",
    microphoneActive: false,
    microphoneFgsActive: true,
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

test("failed notification Unmute is discarded so later deafen, undeafen, and disconnect apply in order", async () => {
  const operations: string[] = [];
  const acknowledged: string[] = [];
  const discarded: string[] = [];
  const actions: VoiceSessionAction[] = [
    { id: "unmute", sequence: 1, sessionId: "call", action: "setMicMuted", value: false },
    { id: "deafen", sequence: 2, sessionId: "call", action: "setDeafened", value: true },
    { id: "undeafen", sequence: 3, sessionId: "call", action: "setDeafened", value: false },
    { id: "disconnect", sequence: 4, sessionId: "call", action: "disconnect" },
  ];

  const result = await processVoiceSessionActions(
    actions,
    async (action) => {
      operations.push(`apply:${action.id}`);
      return action.id === "unmute" ? "discard_failed_unmute" : true;
    },
    async (id) => {
      acknowledged.push(id);
      operations.push(`ack:${id}`);
      return true;
    },
    () => true,
    async (id) => {
      discarded.push(id);
      operations.push(`discard:${id}`);
      return false; // simulated SharedPreferences commit failure
    },
  );

  assert.deepEqual(discarded, ["unmute"]);
  assert.deepEqual(acknowledged, ["deafen", "undeafen", "disconnect"]);
  assert.deepEqual(operations, [
    "apply:unmute",
    "discard:unmute",
    "apply:deafen",
    "ack:deafen",
    "apply:undeafen",
    "ack:undeafen",
    "apply:disconnect",
    "ack:disconnect",
  ]);
  assert.equal(result.disconnected, true);
  assert.equal(result.blocked, false);
});

test("failed discard and JS restart cannot replay Unmute; later controls still drain", async () => {
  const attemptGuard = new VoiceSessionUnmuteAttemptGuard();
  let nativeClaim = true;
  let microphoneAttempts = 0;
  const appliedControls: string[] = [];
  const firstDrain = await processVoiceSessionActions(
    [
      {
        id: "unmute",
        sequence: 1,
        sessionId: "call",
        action: "setMicMuted",
        value: false,
      },
      { id: "deafen", sequence: 2, sessionId: "call", action: "setDeafened", value: true },
      { id: "undeafen", sequence: 3, sessionId: "call", action: "setDeafened", value: false },
      { id: "disconnect", sequence: 4, sessionId: "call", action: "disconnect" },
    ],
    async (action) => {
      if (action.action === "setMicMuted" && action.value === false) {
        const hasAuthorization = await consumeUnmuteClaimOnce(
          attemptGuard,
          action.sessionId,
          action.id,
          Promise.resolve(true),
          async () => {
            const authorized = nativeClaim;
            nativeClaim = false;
            return authorized;
          },
        );
        if (!hasAuthorization) return "discard_failed_unmute";
        microphoneAttempts += 1;
        return "discard_failed_unmute"; // authorized getUserMedia/capture attempt failed
      }
      appliedControls.push(action.id);
      return true;
    },
    async () => true,
    () => true,
    async () => false, // native discard commit failed; the durable row remains
  );

  assert.equal(firstDrain.disconnected, true);
  assert.equal(firstDrain.blocked, false);
  assert.equal(microphoneAttempts, 1);
  assert.deepEqual(appliedControls, ["deafen", "undeafen", "disconnect"]);

  // A repeated drain in this runtime cannot reclaim the consumed native claim.
  const replayDrain = await processVoiceSessionActions(
    [
      {
        id: "unmute",
        sequence: 1,
        sessionId: "call",
        action: "setMicMuted",
        value: false,
      },
      { id: "later-deafen", sequence: 2, sessionId: "call", action: "setDeafened", value: true },
      { id: "later-disconnect", sequence: 3, sessionId: "call", action: "disconnect" },
    ],
    async (action) => {
      if (action.action === "setMicMuted" && action.value === false) {
        const authorized = await consumeUnmuteClaimOnce(
          attemptGuard,
          action.sessionId,
          action.id,
          Promise.resolve(true),
          async () => {
            const claimed = nativeClaim;
            nativeClaim = false;
            return claimed;
          },
        );
        if (!authorized) return "discard_failed_unmute";
        microphoneAttempts += 1;
      }
      appliedControls.push(action.id);
      return true;
    },
    async () => true,
    () => true,
    async () => {
      throw new Error("discard bridge rejected");
    },
  );

  assert.equal(replayDrain.disconnected, true);
  assert.equal(replayDrain.blocked, false);
  assert.equal(microphoneAttempts, 1);
  assert.deepEqual(appliedControls.slice(-2), ["later-deafen", "later-disconnect"]);

  // A new JS runtime has no guard, but Android process death also destroys its
  // non-persistent claim; the leftover outbox row still cannot start capture.
  const restartedGuard = new VoiceSessionUnmuteAttemptGuard();
  const restartedAuthorization = await consumeUnmuteClaimOnce(
    restartedGuard,
    "call",
    "unmute",
    Promise.resolve(true),
    async () => nativeClaim,
  );
  assert.equal(restartedAuthorization, false);
  assert.equal(microphoneAttempts, 1);
});

test("native claim bridge rejection burns only the matching session/action ID", async () => {
  const guard = new VoiceSessionUnmuteAttemptGuard();
  let bridgeCalls = 0;
  const failedConsume = () => consumeUnmuteClaimOnce(
    guard,
    "room-a",
    "action-1",
    Promise.resolve(true),
    async () => {
      bridgeCalls += 1;
      throw new Error("native claim bridge rejected");
    },
  );
  assert.equal(await failedConsume(), false);
  assert.equal(await failedConsume(), false);
  assert.equal(bridgeCalls, 1);

  assert.equal(await consumeUnmuteClaimOnce(guard, "room-b", "action-1", Promise.resolve(true), async () => true), true);
  assert.equal(await consumeUnmuteClaimOnce(guard, "room-a", "action-2", Promise.resolve(true), async () => true), true);
  assert.equal(await consumeUnmuteClaimOnce(new VoiceSessionUnmuteAttemptGuard(), "room-a", "action-1", Promise.resolve(true), async () => false), false);
});

test("Unmute consume waits for the one-time startup reset barrier", async () => {
  let resetCalls = 0;
  let finishReset!: (result: boolean) => void;
  const resetBarrier = createUnmuteClaimResetBarrier(() => {
    resetCalls += 1;
    return new Promise<boolean>((resolve) => {
      finishReset = resolve;
    });
  }, 100);
  const guard = new VoiceSessionUnmuteAttemptGuard();
  let consumeCalls = 0;
  const consume = consumeUnmuteClaimOnce(
    guard,
    "call",
    "unmute",
    resetBarrier,
    async () => {
      consumeCalls += 1;
      return true;
    },
    100,
  );

  await Promise.resolve();
  assert.equal(resetCalls, 1);
  assert.equal(consumeCalls, 0);
  finishReset(true);
  assert.equal(await consume, true);
  assert.equal(consumeCalls, 1);
  assert.equal(await consumeUnmuteClaimOnce(guard, "call", "unmute", resetBarrier, async () => true), false);
  assert.equal(resetCalls, 1);
});

test("startup reset failure blocks stale claims after consume and discard both reject", async (t) => {
  for (const resetResult of ["rejected", "false"] as const) {
    await t.test(`reset ${resetResult}`, async () => {
      let nativeClaimStillPresent = true;
      let nativeResetCalls = 0;
      let nativeConsumeCalls = 0;
      let microphoneAttempts = 0;
      const queuedActions: VoiceSessionAction[] = [
        { id: "stale-unmute", sequence: 1, sessionId: "call", action: "setMicMuted", value: false },
        { id: "deafen", sequence: 2, sessionId: "call", action: "setDeafened", value: true },
        { id: "disconnect", sequence: 3, sessionId: "call", action: "disconnect" },
      ];

      // The old JS runtime had already reset at startup; the notification then
      // created this claim. Both bridge failures happen before native execution.
      const oldRuntimeDrain = await processVoiceSessionActions(
        queuedActions.slice(0, 1),
        async (action) => {
          const authorized = await consumeUnmuteClaimOnce(
            new VoiceSessionUnmuteAttemptGuard(),
            action.sessionId,
            action.id,
            Promise.resolve(true),
            async () => {
              throw new Error("consume rejected before native execution");
            },
          );
          if (!authorized) return "discard_failed_unmute";
          microphoneAttempts += 1;
          return true;
        },
        async () => true,
        () => true,
        async () => {
          throw new Error("discard rejected before native execution");
        },
      );
      assert.equal(oldRuntimeDrain.blocked, false);
      assert.equal(nativeClaimStillPresent, true);
      assert.equal(queuedActions[0]?.id, "stale-unmute");
      assert.equal(microphoneAttempts, 0);

      const resetBarrier = createUnmuteClaimResetBarrier(() => {
        nativeResetCalls += 1;
        return resetResult === "rejected"
          ? Promise.reject(new Error("reset bridge rejected before native execution"))
          : Promise.resolve(false);
      }, 20);
      const newRuntimeGuard = new VoiceSessionUnmuteAttemptGuard();
      const controlsApplied: string[] = [];
      const newRuntimeDrain = await processVoiceSessionActions(
        queuedActions,
        async (action) => {
          if (action.action === "setMicMuted" && action.value === false) {
            const authorized = await consumeUnmuteClaimOnce(
              newRuntimeGuard,
              action.sessionId,
              action.id,
              resetBarrier,
              async () => {
                nativeConsumeCalls += 1;
                const claimed = nativeClaimStillPresent;
                nativeClaimStillPresent = false;
                return claimed;
              },
              20,
            );
            if (!authorized) return "discard_failed_unmute";
            microphoneAttempts += 1;
            return true;
          }
          controlsApplied.push(action.id);
          return true;
        },
        async () => true,
        () => true,
        async () => {
          throw new Error("retry discard rejection");
        },
      );

      assert.equal(newRuntimeDrain.disconnected, true);
      assert.equal(newRuntimeDrain.blocked, false);
      assert.equal(nativeResetCalls, 1);
      assert.equal(nativeConsumeCalls, 0);
      assert.equal(nativeClaimStillPresent, true);
      assert.equal(microphoneAttempts, 0);
      assert.deepEqual(controlsApplied, ["deafen", "disconnect"]);
    });
  }
});

test("unresolved reset, consume, and discard bridges fail within a bound", async () => {
  const never = () => new Promise<boolean>(() => {});
  const resetBarrier = createUnmuteClaimResetBarrier(never, 5);
  const guard = new VoiceSessionUnmuteAttemptGuard();
  let nativeConsumeCalls = 0;
  const authorized = await consumeUnmuteClaimOnce(
    guard,
    "call",
    "unmute",
    resetBarrier,
    async () => {
      nativeConsumeCalls += 1;
      return true;
    },
    5,
  );
  assert.equal(authorized, false);
  assert.equal(nativeConsumeCalls, 0);

  const laterControls: string[] = [];
  const drain = await processVoiceSessionActions(
    [
      { id: "unmute", sequence: 1, sessionId: "call", action: "setMicMuted", value: false },
      { id: "deafen", sequence: 2, sessionId: "call", action: "setDeafened", value: true },
      { id: "disconnect", sequence: 3, sessionId: "call", action: "disconnect" },
    ],
    async (action) => {
      if (action.action === "setMicMuted") return "discard_failed_unmute";
      laterControls.push(action.id);
      return true;
    },
    async () => true,
    () => true,
    () => callBooleanBridgeWithTimeout(never, 5),
  );
  assert.equal(drain.disconnected, true);
  assert.equal(drain.blocked, false);
  assert.deepEqual(laterControls, ["deafen", "disconnect"]);

  let consumeCalls = 0;
  assert.equal(await consumeUnmuteClaimOnce(
    new VoiceSessionUnmuteAttemptGuard(),
    "call",
    "stalled-consume",
    Promise.resolve(true),
    async () => {
      consumeCalls += 1;
      return new Promise<boolean>(() => {});
    },
    5,
  ), false);
  assert.equal(consumeCalls, 1);
});

test("failed-action discard cannot remove mute, deafen, or disconnect commands", async () => {
  const discarded: string[] = [];
  const result = await processVoiceSessionActions(
    [{ id: "deafen", sequence: 1, sessionId: "call", action: "setDeafened", value: true }],
    async () => "discard_failed_unmute",
    async () => true,
    () => true,
    async (id) => {
      discarded.push(id);
      return true;
    },
  );

  assert.deepEqual(discarded, []);
  assert.equal(result.blocked, true);
  assert.equal(result.blockedActionId, "deafen");
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
