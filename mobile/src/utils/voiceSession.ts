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
  microphoneFgsActive?: boolean;
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
  microphoneFgsActive?: boolean;
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
  if (!status?.running) return false;
  if (status.microphoneFgsActive === true) return true;

  // On API 30+, activeTypes reports the FGS type independently from whether
  // RoomSession currently owns a live microphone track (muted keeps the type).
  if (androidApiLevel >= 30) {
    return ((status.activeTypes ?? 0) & MICROPHONE_FOREGROUND_SERVICE_TYPE) !== 0;
  }

  // Before API 30 there is no microphone foreground-service type bit. A
  // successful FGS capability signal is the strongest available evidence.
  return status.microphoneActive === true;
}
