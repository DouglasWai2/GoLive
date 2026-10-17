import { orderVoiceSessionActions, type VoiceSessionAction } from "./voiceSession";

export type VoiceSessionActionProcessResult = {
  processed: number;
  blocked: boolean;
  disconnected: boolean;
  blockedActionId?: string;
};

/** Events emitted by a failed action must not immediately retry that same item. */
export function shouldRetryVoiceSessionDrain(
  retryRequestedDuringDrain: boolean,
  actionBlocked: boolean,
): boolean {
  return retryRequestedDuringDrain && !actionBlocked;
}

/** Applies persisted notification commands in sequence and ACKs only successes. */
export async function processVoiceSessionActions(
  actions: readonly VoiceSessionAction[],
  apply: (action: VoiceSessionAction) => Promise<boolean>,
  acknowledge: (actionId: string) => Promise<boolean>,
  isCurrent: () => boolean = () => true,
): Promise<VoiceSessionActionProcessResult> {
  let processed = 0;

  for (const action of orderVoiceSessionActions(actions)) {
    if (!isCurrent() || !(await apply(action))) {
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
