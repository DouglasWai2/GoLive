import { useEffect, useRef, useState } from "react";
import { RoomSession } from "@golive/core";
import type {
  Peer,
  PeerConnectionState,
  OutboundVideoStats,
  RemoteVideoStats,
  ShareSettings,
  SocketStatus,
  VoiceState,
} from "@golive/core";
import { createSessionDeps } from "../services/sessionDeps";
import { playNotificationSound } from "../utils/notificationSounds";

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
  const [remoteVoiceStreams, setRemoteVoiceStreams] = useState<Record<string, MediaStream>>({});

  const sessionRef = useRef<RoomSession | null>(null);

  useEffect(() => {
    let hasLocalStream = false;
    let micMuted = true;
    let playLifecycleSounds = true;
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

          setLocalStream(stream as MediaStream | null);
        },
        onIsStartingShare: setIsStartingShare,
        onRemoteStream: (peerId, stream) => {
          setRemoteStreams((current) => {
            const next = { ...current };

            if (stream) {
              next[peerId] = stream as MediaStream;
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
          setRemoteVoiceStreams((current) => {
            const next = { ...current };

            if (track) {
              next[peerId] = new MediaStream([track as MediaStreamTrack]);
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
      createSessionDeps(),
    );

    sessionRef.current = session;

    session.start(roomId, name, token);
    session.joinVoice();

    const resume = () => session.resume();
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible") {
        session.resume();
      }
    };

    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resumeWhenVisible);

    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      playLifecycleSounds = false;
      session.stop();
      sessionRef.current = null;
    };
  }, [roomId, name, token]);

  const startSharing = (settings: ShareSettings) => sessionRef.current?.startSharing(settings);
  const stopSharing = () => sessionRef.current?.stopSharing();
  const setMicrophoneMuted = (muted: boolean) =>
    sessionRef.current?.setMicrophoneMuted(muted);

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
    remoteVoiceStreams,
    setError,
    startSharing,
    stopSharing,
    setMicrophoneMuted,
  };
}
