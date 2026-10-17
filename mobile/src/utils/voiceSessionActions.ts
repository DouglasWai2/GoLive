import { orderVoiceSessionActions, type VoiceSessionAction } from "./voiceSession";

export type VoiceSessionActionProcessResult = {
  processed: number;
  blocked: boolean;
  disconnected: boolean;
  blockedActionId?: string;
};

export type VoiceSessionActionApplyResult = boolean | "discard_failed_unmute";

/** Bound native bridge stalls so a failed Unmute cannot hold later controls forever. */
export const VOICE_SESSION_BRIDGE_TIMEOUT_MS = 3_000;

/** Calls one boolean bridge operation once and fails closed on rejection or timeout. */
export function callBooleanBridgeWithTimeout(
  operation: () => Promise<boolean>,
  timeoutMs = VOICE_SESSION_BRIDGE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value === true);
    };
    const timeout = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    try {
      Promise.resolve(operation()).then(finish, () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** One-time startup reset barrier; its result stays false after rejection/timeout. */
export function createUnmuteClaimResetBarrier(
  resetNativeClaims: () => Promise<boolean>,
  timeoutMs = VOICE_SESSION_BRIDGE_TIMEOUT_MS,
): Promise<boolean> {
  return callBooleanBridgeWithTimeout(resetNativeClaims, timeoutMs);
}

/** JS-side burn-before-call guard, including when the native bridge rejects. */
export class VoiceSessionUnmuteAttemptGuard {
  // The native durable queue is capped at 12 actions; retain more than that so
  // every still-pending action stays burned without unbounded process growth.
  private static readonly MAX_TRACKED_IDS = 64;
  private readonly attempted = new Map<string, true>();

  begin(sessionId: string, actionId: string): boolean {
    const key = `${sessionId}\u0000${actionId}`;
    if (this.attempted.has(key)) return false;
    this.attempted.set(key, true);
    if (this.attempted.size > VoiceSessionUnmuteAttemptGuard.MAX_TRACKED_IDS) {
      const oldest = this.attempted.keys().next().value;
      if (oldest !== undefined) this.attempted.delete(oldest);
    }
    return true;
  }

  clearSession(sessionId: string): void {
    const prefix = `${sessionId}\u0000`;
    for (const key of this.attempted.keys()) {
      if (key.startsWith(prefix)) this.attempted.delete(key);
    }
  }
}

/** Burns the action ID before the bridge call so a rejection cannot enable replay. */
export async function consumeUnmuteClaimOnce(
  guard: VoiceSessionUnmuteAttemptGuard,
  sessionId: string,
  actionId: string,
  resetBarrier: Promise<boolean>,
  consumeNativeClaim: () => Promise<boolean>,
  timeoutMs = VOICE_SESSION_BRIDGE_TIMEOUT_MS,
): Promise<boolean> {
  if (!guard.begin(sessionId, actionId)) return false;
  try {
    // Burn first; a failed startup reset must not make this action retryable.
    if (await resetBarrier !== true) return false;
  } catch {
    return false;
  }
  return callBooleanBridgeWithTimeout(consumeNativeClaim, timeoutMs);
}

/** Events emitted by a failed action must not immediately retry that same item. */
export function shouldRetryVoiceSessionDrain(
  retryRequestedDuringDrain: boolean,
  actionBlocked: boolean,
): boolean {
  return retryRequestedDuringDrain && !actionBlocked;
}

/** Applies queued notification commands in sequence; failed Unmute grants are consumed once. */
export async function processVoiceSessionActions(
  actions: readonly VoiceSessionAction[],
  apply: (action: VoiceSessionAction) => Promise<VoiceSessionActionApplyResult>,
  acknowledge: (actionId: string) => Promise<boolean>,
  isCurrent: () => boolean = () => true,
  discardFailedUnmute: (actionId: string) => Promise<boolean> = async () => false,
): Promise<VoiceSessionActionProcessResult> {
  let processed = 0;

  for (const action of orderVoiceSessionActions(actions)) {
    if (!isCurrent()) {
      return {
        processed,
        blocked: true,
        disconnected: false,
        blockedActionId: action.id,
      };
    }
    const application = await apply(action);
    if (application === "discard_failed_unmute") {
      if (action.action !== "setMicMuted" || action.value !== false) {
        return {
          processed,
          blocked: true,
          disconnected: false,
          blockedActionId: action.id,
        };
      }
      // The native one-shot claim was already consumed (or absent), so this
      // command cannot activate the mic even if best-effort removal fails.
      // Do not let storage/bridge rejection block later safe controls.
      try {
        await discardFailedUnmute(action.id);
      } catch {
        // A missing one-shot grant makes the durable record inert on every drain.
      }
      processed += 1;
      continue;
    }
    if (!application) {
      return {
        processed,
        blocked: true,
        disconnected: false,
        blockedActionId: action.id,
      };
    }
    // A disconnect may synchronously stop the session and trigger unmounting;
    // ACK that command once its effect has completed, even if the room is no
    // longer current. Other action types must not ACK across a room switch.
    if (action.action !== "disconnect" && !isCurrent()) {
      return {
        processed,
        blocked: true,
        disconnected: false,
        blockedActionId: action.id,
      };
    }
    const acknowledged = await acknowledge(action.id);
    processed += 1;
    if (action.action === "disconnect") {
      return {
        processed,
        blocked: !acknowledged,
        disconnected: true,
        ...(acknowledged ? {} : { blockedActionId: action.id }),
      };
    }
    if (!acknowledged) {
      return {
        processed,
        blocked: true,
        disconnected: false,
        blockedActionId: action.id,
      };
    }
  }

  return { processed, blocked: false, disconnected: false };
}
