import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { RoomSession } from "@golive/core";
import type {
  MediaStream,
  OutboundVideoStats,
  Peer,
  PeerConnectionState,
  RemoteVideoStats,
  ShareSettings,
  SocketStatus,
  VoiceState,
} from "@golive/core";
import { SIGNALING_URL } from "../config";
import { nativeAdapter } from "../adapter";
import {
  acknowledgeVoiceSessionAction,
  consumeVoiceSessionActions,
  getActiveVoiceSessionStatus,
  getVoiceSessionStatus,
  isVoiceSessionAvailable,
  startVoiceSession,
  stopVoiceSession,
  subscribeVoiceSessionEvent,
  updateVoiceSession,
  voiceSessionPlatformVersion,
  withVoiceSessionLock,
} from "../native/voiceSession";
import {
  processVoiceSessionActions,
  shouldRetryVoiceSessionDrain,
} from "../utils/voiceSessionActions";
import {
  hasMicrophoneForegroundService,
  orderVoiceSessionActions,
  resolveVoiceSessionRecovery,
  type VoiceSessionOptions,
  type VoiceSessionStatus,
} from "../utils/voiceSession";
import { useRoomAudio } from "./useRoomAudio";

export function useRoom(
  roomId: string,
  name: string,
  token: string,
  onSessionRejected?: () => void,
  onSessionReplaced?: () => void,
  onLeave?: () => void,
) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isStartingShare, setIsStartingShare] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectionStates, setConnectionStates] = useState<Record<string, PeerConnectionState>>({});
  const [remoteStats, setRemoteStats] = useState<Record<string, RemoteVideoStats | null>>({});
  const [outboundStats, setOutboundStats] = useState<Record<string, OutboundVideoStats>>({});
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>({
    joined: true,
    micMuted: true,
    requestingMicrophone: false,
  });
  const [remoteVoiceTracks, setRemoteVoiceTracks] = useState<Record<string, any>>({});
  const [deafened, setDeafenedState] = useState(false);
  const [notificationPermissionGranted, setNotificationPermissionGranted] = useState<boolean | null>(null);
  const [voiceSessionReady, setVoiceSessionReady] = useState(!isVoiceSessionAvailable);

  const sessionRef = useRef<RoomSession | null>(null);
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;
  const localStreamRef = useRef(localStream);
  localStreamRef.current = localStream;
  const deafenedRef = useRef(deafened);
  deafenedRef.current = deafened;
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  const syncVoiceSessionRef = useRef<(overrides?: Partial<VoiceSessionOptions>) => Promise<boolean>>(
    async () => false,
  );
  const setMicrophoneMutedRef = useRef<(muted: boolean) => Promise<boolean>>(
    async () => false,
  );
  const setDeafened = useCallback((nextDeafened: boolean) => {
    deafenedRef.current = nextDeafened;
    setDeafenedState(nextDeafened);
    void syncVoiceSessionRef.current({ deafened: nextDeafened });
  }, []);
  const { startRoomAudio, stopRoomAudio, playNotificationSound } = useRoomAudio();

  useEffect(() => {
    let effectActive = true;
    let session!: RoomSession;
    let hasLocalStream = false;
    let micMuted = true;
    let requestingMicrophone = false;
    let playLifecycleSounds = true;
    let nativeCallStarted = false;
    let nativeStatus: VoiceSessionStatus | null = null;
    let startOperation: Promise<boolean> | null = null;
    let drainingActions = false;
    let drainAgain = false;
    let drainPendingActions: () => Promise<void> = async () => {};
    let actionBlocked = false;
    let sessionId: string = globalThis.crypto.randomUUID();
    const canUseNativeService = Platform.OS === "android" && isVoiceSessionAvailable;
    let nativeReady = !canUseNativeService;
    let nativeStateReconciled = !canUseNativeService;
    let nativeRecoveryFailed = false;
    let nativeRecoveryPromise: Promise<void> = Promise.resolve();
    const initialVoiceState: VoiceState = {
      joined: true,
      micMuted: true,
      requestingMicrophone: false,
    };
    voiceStateRef.current = initialVoiceState;
    localStreamRef.current = null;
    deafenedRef.current = false;
    setStatus("connecting");
    setPeers([]);
    setLocalStream(null);
    setIsStartingShare(false);
    setRemoteStreams({});
    setConnectionStates({});
    setRemoteStats({});
    setOutboundStats({});
    setError("");
    setVoiceState(initialVoiceState);
    setRemoteVoiceTracks({});
    setDeafenedState(false);
    setNotificationPermissionGranted(null);
    setVoiceSessionReady(!canUseNativeService);
    const isCurrent = () => effectActive && sessionRef.current === session;

    const buildOptions = (overrides: Partial<VoiceSessionOptions> = {}): VoiceSessionOptions => ({
      sessionId,
      roomLabel: roomId,
      playbackActive: true,
      microphoneActive: !voiceStateRef.current.micMuted,
      micMuted: voiceStateRef.current.micMuted,
      deafened: deafenedRef.current,
      projectionActive: Boolean(localStreamRef.current),
      ...overrides,
    });

    const stopOwnedNativeCall = async (): Promise<boolean> => {
      if (!canUseNativeService) return true;
      const current = await getVoiceSessionStatus(sessionId);
      if (!current.running || current.sessionId !== sessionId) {
        nativeCallStarted = false;
        nativeStatus = current;
        return true;
      }
      const result = await stopVoiceSession(sessionId);
      if (result.started) {
        nativeCallStarted = false;
        nativeStatus = { running: false, sessionId };
        return true;
      }
      nativeStatus = await getVoiceSessionStatus(sessionId);
      nativeCallStarted = nativeStatus.running && nativeStatus.sessionId === sessionId;
      return !nativeCallStarted;
    };

    const reconcileNativeSession = async (): Promise<void> => {
      if (!canUseNativeService) {
        nativeReady = true;
        return;
      }
      try {
        await withVoiceSessionLock(async () => {
          if (!isCurrent()) return;
          const active = await getActiveVoiceSessionStatus();
          if (!isCurrent()) return;
          nativeStatus = active;
          if (typeof active.notificationPermissionGranted === "boolean") {
            setNotificationPermissionGranted(active.notificationPermissionGranted);
          }

          const recovery = resolveVoiceSessionRecovery(active, roomId, sessionId);
          if (recovery.adoptExisting) {
            sessionId = recovery.sessionId;
            nativeCallStarted = true;
            // Keep the new RoomSession's default muted microphone: the prior
            // JS bridge no longer owns a live capture track. Deafen is safe to
            // restore because it only controls local playback.
            deafenedRef.current = recovery.deafened;
            setDeafenedState(recovery.deafened);
            return;
          }

          if (!recovery.stopSessionId) return;
          const stopped = await stopVoiceSession(recovery.stopSessionId);
          if (!isCurrent()) return;
          if (stopped.started) {
            nativeCallStarted = false;
            nativeStatus = { running: false, sessionId: null };
            return;
          }

          const stillActive = await getActiveVoiceSessionStatus();
          if (stillActive.running) {
            nativeStatus = stillActive;
            nativeRecoveryFailed = true;
            setError("Could not close the previous room's call service. Reopen GoLive and try again.");
          }
        });
      } catch {
        if (isCurrent()) {
          nativeRecoveryFailed = true;
          deafenedRef.current = true;
          setDeafenedState(true);
          setError("Could not verify the current call service. Reopen GoLive before starting another room.");
        }
      } finally {
        nativeReady = true;
        if (isCurrent()) setVoiceSessionReady(true);
      }
    };

    const startNativeCall = (options: VoiceSessionOptions): Promise<boolean> => {
      if (!canUseNativeService || !nativeReady || nativeRecoveryFailed || AppState.currentState !== "active") {
        return Promise.resolve(false);
      }
      if (nativeCallStarted) return Promise.resolve(true);
      if (startOperation) return startOperation;

      const operation = withVoiceSessionLock(async () => {
        if (!isCurrent() || AppState.currentState !== "active") return false;
        if (nativeCallStarted) return true;
        const result = await startVoiceSession(options);
        if (!isCurrent()) {
          if (result.started && result.sessionId === sessionId) await stopOwnedNativeCall();
          return false;
        }
        if (!result.started || result.sessionId !== sessionId) return false;
        nativeCallStarted = true;
        nativeStatus = {
          running: true,
          sessionId,
          playbackActive: options.playbackActive,
          microphoneActive: options.microphoneActive,
          micMuted: options.micMuted,
          deafened: options.deafened,
          activeTypes: result.activeTypes,
          notificationPermissionGranted: result.notificationPermissionGranted,
        };
        if (typeof result.notificationPermissionGranted === "boolean") {
          setNotificationPermissionGranted(result.notificationPermissionGranted);
        }
        return true;
      });
      startOperation = operation;
      void operation.then(
        () => { if (startOperation === operation) startOperation = null; },
        () => { if (startOperation === operation) startOperation = null; },
      );
      return operation;
    };

    const syncNativeState = async (
      overrides: Partial<VoiceSessionOptions> = {},
    ): Promise<boolean> => {
      if (!canUseNativeService || !isCurrent()) return false;
      await nativeRecoveryPromise;
      if (!nativeReady || !isCurrent() || nativeRecoveryFailed) return false;
      const options = buildOptions(overrides);
      const microphoneFgsConfirmed = hasMicrophoneForegroundService(
        nativeStatus,
        voiceSessionPlatformVersion,
      );
      if (
        options.microphoneActive
        && AppState.currentState !== "active"
        && !localStreamRef.current
        && !microphoneFgsConfirmed
      ) {
        if (!voiceStateRef.current.micMuted) await session.setMicrophoneMuted(true);
        return false;
      }

      if (!nativeCallStarted) {
        const started = await startNativeCall(options);
        if (!started || !isCurrent()) return false;
      }
      const result = await withVoiceSessionLock(async () => {
        if (!isCurrent() || !nativeCallStarted) return null;
        return updateVoiceSession(options);
      });
      if (!isCurrent()) return false;
      if (result?.started && result.sessionId === sessionId) {
        nativeStatus = {
          running: true,
          sessionId,
          playbackActive: options.playbackActive,
          microphoneActive: options.microphoneActive,
          micMuted: options.micMuted,
          deafened: options.deafened,
          activeTypes: result.activeTypes,
          notificationPermissionGranted: result.notificationPermissionGranted,
        };
        if (typeof result.notificationPermissionGranted === "boolean") {
          setNotificationPermissionGranted(result.notificationPermissionGranted);
        }
        nativeStateReconciled = true;
        return true;
      }

      nativeStatus = await getVoiceSessionStatus(sessionId);
      nativeCallStarted = nativeStatus.running && nativeStatus.sessionId === sessionId;
      if (
        options.microphoneActive
        && AppState.currentState !== "active"
        && !localStreamRef.current
        && !voiceStateRef.current.micMuted
      ) {
        await session.setMicrophoneMuted(true);
      }
      return false;
    };

    syncVoiceSessionRef.current = syncNativeState;

    const applyMicrophoneMute = async (muted: boolean): Promise<boolean> => {
      if (!isCurrent()) return false;
      if (!muted && Platform.OS === "android" && AppState.currentState !== "active") {
        nativeStatus = await getVoiceSessionStatus(sessionId);
        nativeCallStarted = nativeStatus.running && nativeStatus.sessionId === sessionId;
        if (!hasMicrophoneForegroundService(nativeStatus, voiceSessionPlatformVersion)) return false;
      }

      await session.setMicrophoneMuted(muted);
      if (!isCurrent() || voiceStateRef.current.micMuted !== muted) return false;
      if (canUseNativeService) {
        const synchronized = await syncNativeState({ microphoneActive: !muted, micMuted: muted });
        if (!muted && AppState.currentState !== "active") {
          if (
            !synchronized
            || !hasMicrophoneForegroundService(nativeStatus, voiceSessionPlatformVersion)
          ) {
            await session.setMicrophoneMuted(true);
            return false;
          }
        }
      }
      return true;
    };
    setMicrophoneMutedRef.current = applyMicrophoneMute;

    const removeStatusListener = subscribeVoiceSessionEvent("serviceStatus", (payload) => {
      if (!isCurrent()) return;
      const status = payload as VoiceSessionStatus;
      if (status.sessionId !== sessionId) return;
      nativeStatus = status;
      nativeCallStarted = status.running;
      if (
        !status.running
        && AppState.currentState !== "active"
        && !localStreamRef.current
        && !voiceStateRef.current.micMuted
      ) {
        void session.setMicrophoneMuted(true);
      }
    });

    drainPendingActions = async () => {
      if (!canUseNativeService || !isCurrent()) return;
      if (drainingActions) {
        drainAgain = true;
        return;
      }

      drainingActions = true;
      actionBlocked = false;
      try {
        await nativeRecoveryPromise;
        if (!nativeReady || !nativeStateReconciled || nativeRecoveryFailed || !isCurrent()) return;
        do {
          drainAgain = false;
          if (!nativeCallStarted && AppState.currentState === "active") {
            await startNativeCall(buildOptions());
          }
          if (!nativeCallStarted || !isCurrent()) return;

          const actions = await consumeVoiceSessionActions(sessionId);
          const result = await processVoiceSessionActions(
            actions,
            async (action) => {
              if (!isCurrent() || action.sessionId !== sessionId) return false;
              if (action.action === "disconnect") {
                session.stop();
                return withVoiceSessionLock(stopOwnedNativeCall);
              }
              if (typeof action.value !== "boolean") return false;
              if (action.action === "setMicMuted") {
                return setMicrophoneMutedRef.current(action.value);
              }
              if (action.action === "setDeafened") {
                deafenedRef.current = action.value;
                setDeafenedState(action.value);
                playNotificationSound(action.value ? "deafen" : "undeafen");
                await syncNativeState({ deafened: action.value });
                return true;
              }
              return false;
            },
            (actionId) => acknowledgeVoiceSessionAction(sessionId, actionId),
            isCurrent,
          );

          if (result.disconnected) {
            if (isCurrent()) leaveRef.current?.();
            return;
          }
          if (result.blocked) {
            actionBlocked = true;
            if (drainAgain && result.blockedActionId) {
              const currentActions = await consumeVoiceSessionActions(sessionId);
              const firstPending = orderVoiceSessionActions(currentActions)[0];
              // If an explicit native command replaced the blocked item while
              // it was running (for example Disconnect), process that command
              // without retrying the failed Unmute.
              if (firstPending && firstPending.id !== result.blockedActionId) {
                actionBlocked = false;
              }
            }
            break;
          }
        } while (drainAgain);
      } catch {
        actionBlocked = true;
        // Pending native actions are durable and will be retried on app resume.
      } finally {
        drainingActions = false;
        if (
          shouldRetryVoiceSessionDrain(drainAgain, actionBlocked)
          && isCurrent()
        ) void drainPendingActions();
      }
    };

    const removeActionListener = subscribeVoiceSessionEvent("actionRequested", () => {
      void drainPendingActions();
    });

    void startRoomAudio().then((granted) => {
      if (effectActive && typeof granted === "boolean") {
        setNotificationPermissionGranted(granted);
      }
    });

    session = new RoomSession(
      {
        onStatus: (nextStatus) => { if (effectActive) setStatus(nextStatus); },
        onPeers: (nextPeers) => { if (effectActive) setPeers(nextPeers); },
        onPeerJoined: () => {
          if (playLifecycleSounds) playNotificationSound("peer-join");
        },
        onPeerLeft: () => {
          if (playLifecycleSounds) playNotificationSound("peer-leave");
        },
        onPeerSharingChanged: (peer) => {
          if (playLifecycleSounds) {
            playNotificationSound(peer.sharing ? "share-start" : "share-stop");
          }
        },
        onLocalStream: (stream) => {
          if (!effectActive) return;
          const nextHasLocalStream = Boolean(stream);

          if (nextHasLocalStream !== hasLocalStream) {
            playNotificationSound(nextHasLocalStream ? "share-start" : "share-stop");
            hasLocalStream = nextHasLocalStream;
          }

          localStreamRef.current = stream;
          if (effectActive) setLocalStream(stream);
          void syncNativeState({ projectionActive: nextHasLocalStream });
        },
        onIsStartingShare: (starting) => { if (effectActive) setIsStartingShare(starting); },
        onRemoteStream: (streamId, stream) => {
          if (!effectActive) return;
          for (const track of stream?.getAudioTracks() ?? []) {
            (track as typeof track & { _setVolume?: (volume: number) => void })
              ._setVolume?.(0);
          }

          setRemoteStreams((current) => {
            const next = { ...current };

            if (stream) {
              next[streamId] = stream;
            } else {
              delete next[streamId];
            }

            return next;
          });
        },
        onConnectionState: (streamId, state) => {
          if (!effectActive) return;
          setConnectionStates((current) => {
            const next = { ...current };

            if (state) {
              next[streamId] = state;
            } else {
              delete next[streamId];
            }

            return next;
          });
        },
        onRemoteStats: (streamId, stats) => {
          if (!effectActive) return;
          setRemoteStats((current) => {
            const next = { ...current };

            if (stats) {
              next[streamId] = stats;
            } else {
              delete next[streamId];
            }

            return next;
          });
        },
        onOutboundStats: (peerId, stats) => {
          if (!effectActive) return;
          setOutboundStats((current) => {
            const next = { ...current };

            if (stats) {
              next[peerId] = stats;
            } else {
              delete next[peerId];
            }

            return next;
          });
        },
        onVoiceState: (state) => {
          if (!effectActive) return;
          if (playLifecycleSounds && state.micMuted !== micMuted) {
            playNotificationSound(state.micMuted ? "mic-mute" : "mic-unmute");
          }

          const microphoneStateChanged = state.micMuted !== micMuted;
          const microphoneRequestFinished = requestingMicrophone && !state.requestingMicrophone;
          micMuted = state.micMuted;
          requestingMicrophone = state.requestingMicrophone;
          voiceStateRef.current = state;
          if (effectActive) setVoiceState(state);
          if (microphoneStateChanged) {
            void syncNativeState({ microphoneActive: !state.micMuted, micMuted: state.micMuted });
          }
          if (microphoneRequestFinished) void drainPendingActions();
        },
        onRemoteVoiceTrack: (peerId, track) => {
          if (!effectActive) return;
          setRemoteVoiceTracks((current) => {
            const next = { ...current };
            if (track) {
              next[peerId] = track;
            } else {
              delete next[peerId];
            }
            return next;
          });
        },
        onError: (message) => { if (effectActive) setError(message); },
        onSessionRejected: () => { if (effectActive) onSessionRejected?.(); },
        onSessionReplaced: () => { if (effectActive) onSessionReplaced?.(); },
      },
      {
        baseUrl: SIGNALING_URL,
        adapter: nativeAdapter,
      },
    );

    sessionRef.current = session;
    nativeRecoveryPromise = reconcileNativeSession();

    session.start(roomId, name, token);
    session.joinVoice();
    if (canUseNativeService) {
      void nativeRecoveryPromise.then(async () => {
        if (!isCurrent()) return;
        const reconciled = await syncNativeState();
        if (reconciled && isCurrent()) await drainPendingActions();
      });
    }

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        session.resume();
        if (canUseNativeService) {
          void getActiveVoiceSessionStatus().then((active) => {
            if (effectActive && typeof active.notificationPermissionGranted === "boolean") {
              setNotificationPermissionGranted(active.notificationPermissionGranted);
            }
          }).catch(() => {});
        }
        void (async () => {
          const reconciled = await syncNativeState();
          if (reconciled && isCurrent()) await drainPendingActions();
        })();
      } else {
        const keepMicrophone = Platform.OS === "android"
          ? Boolean(localStreamRef.current)
            || hasMicrophoneForegroundService(nativeStatus, voiceSessionPlatformVersion)
          : undefined;
        const backgroundWork = keepMicrophone === undefined
          ? session.handleAppBackground()
          : session.handleAppBackground({ keepMicrophone });
        void Promise.resolve(backgroundWork).then(() => {
          if (effectActive) {
            void syncNativeState({
              microphoneActive: !voiceStateRef.current.micMuted,
              micMuted: voiceStateRef.current.micMuted,
            });
          }
        });
      }
    });

    return () => {
      effectActive = false;
      appStateSubscription.remove();
      removeActionListener();
      removeStatusListener();
      playLifecycleSounds = false;
      session.stop();
      stopRoomAudio();
      if (sessionRef.current === session) sessionRef.current = null;
      localStreamRef.current = null;
      if (syncVoiceSessionRef.current === syncNativeState) {
        syncVoiceSessionRef.current = async () => false;
      }
      setMicrophoneMutedRef.current = async () => false;
      if (canUseNativeService) void withVoiceSessionLock(stopOwnedNativeCall);
    };
  }, [name, playNotificationSound, roomId, startRoomAudio, stopRoomAudio, token]);

  const startSharing = (settings: ShareSettings) => sessionRef.current?.startSharing(settings);
  const stopSharing = () => sessionRef.current?.stopSharing();
  const focusPeer = useCallback((peerId: string | null) => {
    sessionRef.current?.focusPeer(peerId);
  }, []);
  const setMicrophoneMuted = useCallback(
    (muted: boolean) => setMicrophoneMutedRef.current(muted),
    [],
  );
  const getVoiceAudioLevels = useCallback(
    () => sessionRef.current?.getVoiceAudioLevels() ?? Promise.resolve({ local: 0, peers: {} }),
    [],
  );

  return {
    status,
    peers,
    localStream,
    isStartingShare,
    remoteStreams,
    connectionStates,
    remoteStats,
    outboundStats,
    error,
    voiceState,
    deafened,
    notificationPermissionGranted,
    voiceSessionReady,
    remoteVoiceTracks,
    setError,
    startSharing,
    stopSharing,
    focusPeer,
    setMicrophoneMuted,
    setDeafened,
    getVoiceAudioLevels,
    playNotificationSound,
  };
}
