import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type {
  VoiceSessionAction,
  VoiceSessionOptions,
  VoiceSessionResult,
  VoiceSessionStatus,
} from "../utils/voiceSession";

type VoiceSessionNativeModule = {
  startCall(options: VoiceSessionOptions): Promise<VoiceSessionResult>;
  updateCallState(options: VoiceSessionOptions): Promise<VoiceSessionResult>;
  stopCall(sessionId: string): Promise<VoiceSessionResult>;
  getStatus(sessionId: string): Promise<VoiceSessionStatus>;
  getActiveStatus(): Promise<VoiceSessionStatus>;
  consumePendingActions(sessionId: string): Promise<VoiceSessionAction[]>;
  ackAction(sessionId: string, actionId: string): Promise<boolean>;
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
  && typeof candidate.consumePendingActions === "function"
  && typeof candidate.ackAction === "function"
  ? candidate
  : undefined;

const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

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

export function acknowledgeVoiceSessionAction(
  sessionId: string,
  actionId: string,
): Promise<boolean> {
  return nativeModule?.ackAction(sessionId, actionId) ?? Promise.resolve(false);
}

let nativeOperationQueue: Promise<void> = Promise.resolve();

/** Serializes start/stop transactions across room remounts and room switches. */
export function withVoiceSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeOperationQueue.then(operation, operation);
  nativeOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}
