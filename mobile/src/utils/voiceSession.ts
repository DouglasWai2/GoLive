export type VoiceSessionOptions = {
  sessionId: string;
  roomLabel: string;
  playbackActive: boolean;
  microphoneActive: boolean;
  micMuted: boolean;
  deafened: boolean;
  projectionActive: boolean;
};

export type VoiceSessionResult = {
  started: boolean;
  sessionId: string | null;
  reason?: string;
  activeTypes?: number;
  notificationPermissionGranted?: boolean;
};

export type VoiceSessionStatus = {
  running: boolean;
  sessionId: string | null;
  roomLabel?: string;
  playbackActive?: boolean;
  microphoneActive?: boolean;
  micMuted?: boolean;
  deafened?: boolean;
  projectionActive?: boolean;
  activeTypes?: number;
  notificationPermissionGranted?: boolean;
};

export type VoiceSessionRecovery = {
  sessionId: string;
  adoptExisting: boolean;
  stopSessionId: string | null;
  deafened: boolean;
};

/** Reuse only the service that explicitly identifies the room being restored. */
export function resolveVoiceSessionRecovery(
  active: VoiceSessionStatus,
  roomLabel: string,
  newSessionId: string,
): VoiceSessionRecovery {
  if (!active.running || !active.sessionId) {
    return { sessionId: newSessionId, adoptExisting: false, stopSessionId: null, deafened: false };
  }
  if (active.roomLabel === roomLabel) {
    return {
      sessionId: active.sessionId,
      adoptExisting: true,
      stopSessionId: null,
      deafened: active.deafened === true,
    };
  }
  return {
    sessionId: newSessionId,
    adoptExisting: false,
    stopSessionId: active.sessionId,
    deafened: false,
  };
}

export type VoiceSessionAction = {
  id: string;
  sequence: number;
  sessionId: string;
  action: "disconnect" | "setMicMuted" | "setDeafened";
  value?: boolean;
  createdAt?: number;
};

// Android's ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE is 1 << 7.
export const MICROPHONE_FOREGROUND_SERVICE_TYPE = 1 << 7;

export function orderVoiceSessionActions(
  actions: readonly VoiceSessionAction[],
): VoiceSessionAction[] {
  return [...actions].sort((left, right) => left.sequence - right.sequence);
}

export function hasMicrophoneForegroundService(
  status: VoiceSessionStatus | null,
  androidApiLevel: number,
): boolean {
  if (!status?.running || !status.microphoneActive) return false;

  // Before API 30 there is no microphone foreground-service type bit. A
  // successful foreground-service status plus active microphone config is the
  // strongest signal available on those releases.
  return androidApiLevel < 30
    || ((status.activeTypes ?? 0) & MICROPHONE_FOREGROUND_SERVICE_TYPE) !== 0;
}
