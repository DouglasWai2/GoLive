import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
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
import { useRoomAudio } from "./useRoomAudio";

export function useRoom(
  roomId: string,
  name: string,
  token: string,
  onSessionRejected?: () => void,
  onSessionReplaced?: () => void,
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

  const sessionRef = useRef<RoomSession | null>(null);
  const { startRoomAudio, stopRoomAudio, playNotificationSound } = useRoomAudio(roomId);

  useEffect(() => {
    let hasLocalStream = false;
    let micMuted = true;
    let playLifecycleSounds = true;

    void startRoomAudio();

    const session = new RoomSession(
      {
        onStatus: setStatus,
        onPeers: setPeers,
        onPeerJoined: () => playNotificationSound("peer-join"),
        onPeerLeft: () => playNotificationSound("peer-leave"),
        onPeerSharingChanged: (peer) => {
          playNotificationSound(peer.sharing ? "share-start" : "share-stop");
        },
        onLocalStream: (stream) => {
          const nextHasLocalStream = Boolean(stream);

          if (nextHasLocalStream !== hasLocalStream) {
            playNotificationSound(nextHasLocalStream ? "share-start" : "share-stop");
            hasLocalStream = nextHasLocalStream;
          }

          setLocalStream(stream);
        },
        onIsStartingShare: setIsStartingShare,
        onRemoteStream: (peerId, stream) => {
          for (const track of stream?.getAudioTracks() ?? []) {
            (track as typeof track & { _setVolume?: (volume: number) => void })
              ._setVolume?.(0);
          }

          setRemoteStreams((current) => {
            const next = { ...current };

            if (stream) {
              next[peerId] = stream;
            } else {
              delete next[peerId];
            }

            return next;
          });
        },
        onConnectionState: (peerId, state) => {
          setConnectionStates((current) => {
            const next = { ...current };

            if (state) {
              next[peerId] = state;
            } else {
              delete next[peerId];
            }

            return next;
          });
        },
        onRemoteStats: (peerId, stats) => {
          setRemoteStats((current) => {
            const next = { ...current };

            if (stats) {
              next[peerId] = stats;
            } else {
              delete next[peerId];
            }

            return next;
          });
        },
        onOutboundStats: (peerId, stats) => {
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
          if (playLifecycleSounds && state.micMuted !== micMuted) {
            playNotificationSound(state.micMuted ? "mic-mute" : "mic-unmute");
          }

          micMuted = state.micMuted;
          setVoiceState(state);
        },
        onRemoteVoiceTrack: (peerId, track) => {
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
        onError: setError,
        onSessionRejected,
        onSessionReplaced,
      },
      {
        baseUrl: SIGNALING_URL,
        adapter: nativeAdapter,
      },
    );

    sessionRef.current = session;

    session.start(roomId, name, token);
    session.joinVoice();

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        session.resume();
      } else {
        session.handleAppBackground();
      }
    });

    return () => {
      appStateSubscription.remove();
      playLifecycleSounds = false;
      session.stop();
      stopRoomAudio();
      sessionRef.current = null;
    };
  }, [name, playNotificationSound, roomId, startRoomAudio, stopRoomAudio, token]);

  const startSharing = (settings: ShareSettings) => sessionRef.current?.startSharing(settings);
  const stopSharing = () => sessionRef.current?.stopSharing();
  const setMicrophoneMuted = (muted: boolean) => sessionRef.current?.setMicrophoneMuted(muted);

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
    remoteVoiceTracks,
    setError,
    startSharing,
    stopSharing,
    setMicrophoneMuted,
    playNotificationSound,
  };
}
