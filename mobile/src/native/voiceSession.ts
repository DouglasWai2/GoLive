import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type {
  VoiceSessionAction,
  VoiceSessionOptions,
  VoiceSessionResult,
  VoiceSessionStatus,
} from "../utils/voiceSession";
import {
  callBooleanBridgeWithTimeout,
  consumeUnmuteClaimOnce,
  createUnmuteClaimResetBarrier,
  VOICE_SESSION_BRIDGE_TIMEOUT_MS,
  VoiceSessionUnmuteAttemptGuard,
} from "../utils/voiceSessionActions";

type VoiceSessionNativeModule = {
  startCall(options: VoiceSessionOptions): Promise<VoiceSessionResult>;
  updateCallState(options: VoiceSessionOptions): Promise<VoiceSessionResult>;
  stopCall(sessionId: string): Promise<VoiceSessionResult>;
  getStatus(sessionId: string): Promise<VoiceSessionStatus>;
  getActiveStatus(): Promise<VoiceSessionStatus>;
  resetUnmuteClaims(): Promise<boolean>;
  consumePendingActions(sessionId: string): Promise<VoiceSessionAction[]>;
  consumeUnmuteClaim(sessionId: string, actionId: string): Promise<boolean>;
  ackAction(sessionId: string, actionId: string): Promise<boolean>;
  discardFailedUnmute(sessionId: string, actionId: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const candidate = Platform.OS === "android"
  ? NativeModules.GoLiveVoiceSession as VoiceSessionNativeModule | undefined
  : undefined;

const nativeModule = candidate
  && typeof candidate.startCall === "function"
  && typeof candidate.updateCallState === "function"
  && typeof candidate.stopCall === "function"
  && typeof candidate.getStatus === "function"
  && typeof candidate.getActiveStatus === "function"
  && typeof candidate.resetUnmuteClaims === "function"
  && typeof candidate.consumePendingActions === "function"
  && typeof candidate.consumeUnmuteClaim === "function"
  && typeof candidate.ackAction === "function"
  && typeof candidate.discardFailedUnmute === "function"
  ? candidate
  : undefined;

const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;
const unmuteAttemptGuard = new VoiceSessionUnmuteAttemptGuard();
// Keep the single startup reset result for this JS runtime. A failed/timed-out
// reset permanently disables notification Unmute here, without blocking other actions.
export const voiceSessionUnmuteResetReady = nativeModule
  ? createUnmuteClaimResetBarrier(() => nativeModule.resetUnmuteClaims())
  : Promise.resolve(false);

export const isVoiceSessionAvailable = nativeModule !== undefined;
export const voiceSessionPlatformVersion = Platform.OS === "android"
  ? Number(Platform.Version)
  : 0;

export function subscribeVoiceSessionEvent(
  eventName: "actionRequested" | "serviceStatus",
  listener: (payload: VoiceSessionAction | VoiceSessionStatus) => void,
): () => void {
  if (!eventEmitter) return () => {};
  const subscription = eventEmitter.addListener(eventName, listener);
  return () => subscription.remove();
}

export function startVoiceSession(options: VoiceSessionOptions): Promise<VoiceSessionResult> {
  return nativeModule?.startCall(options) ?? Promise.resolve({
    started: false,
    sessionId: options.sessionId,
    reason: "native_voice_session_unavailable",
  });
}

export function updateVoiceSession(options: VoiceSessionOptions): Promise<VoiceSessionResult> {
  return nativeModule?.updateCallState(options) ?? Promise.resolve({
    started: false,
    sessionId: options.sessionId,
    reason: "native_voice_session_unavailable",
  });
}

export function stopVoiceSession(sessionId: string): Promise<VoiceSessionResult> {
  return nativeModule?.stopCall(sessionId) ?? Promise.resolve({
    started: false,
    sessionId,
    reason: "native_voice_session_unavailable",
  });
}

export function getVoiceSessionStatus(sessionId: string): Promise<VoiceSessionStatus> {
  return nativeModule?.getStatus(sessionId) ?? Promise.resolve({ running: false, sessionId: null });
}

export function getActiveVoiceSessionStatus(): Promise<VoiceSessionStatus> {
  return nativeModule?.getActiveStatus() ?? Promise.resolve({
    running: false,
    sessionId: null,
  });
}

export function consumeVoiceSessionActions(sessionId: string): Promise<VoiceSessionAction[]> {
  return nativeModule?.consumePendingActions(sessionId) ?? Promise.resolve([]);
}

/** Burns the local action ID before touching the native one-shot claim bridge. */
export async function consumeVoiceSessionUnmuteClaim(
  sessionId: string,
  actionId: string,
): Promise<boolean> {
  return consumeUnmuteClaimOnce(
    unmuteAttemptGuard,
    sessionId,
    actionId,
    voiceSessionUnmuteResetReady,
    () => nativeModule?.consumeUnmuteClaim(sessionId, actionId) ?? Promise.resolve(false),
    VOICE_SESSION_BRIDGE_TIMEOUT_MS,
  );
}

export function acknowledgeVoiceSessionAction(
  sessionId: string,
  actionId: string,
): Promise<boolean> {
  return nativeModule?.ackAction(sessionId, actionId) ?? Promise.resolve(false);
}

export function discardFailedVoiceSessionUnmute(
  sessionId: string,
  actionId: string,
): Promise<boolean> {
  return callBooleanBridgeWithTimeout(
    () => nativeModule?.discardFailedUnmute(sessionId, actionId) ?? Promise.resolve(false),
    VOICE_SESSION_BRIDGE_TIMEOUT_MS,
  );
}

let nativeOperationQueue: Promise<void> = Promise.resolve();

/** Serializes start/stop transactions across room remounts and room switches. */
export function withVoiceSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeOperationQueue.then(operation, operation);
  nativeOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}
