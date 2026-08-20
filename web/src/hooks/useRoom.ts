import { useEffect, useRef, useState } from "react";
import type { Peer, RemoteVideoStats, ShareSettings, SocketStatus } from "../types";
import { RoomSession } from "../services/roomSession";

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
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [remoteStats, setRemoteStats] = useState<Record<string, RemoteVideoStats | null>>({});
  const [error, setError] = useState("");

  const sessionRef = useRef<RoomSession | null>(null);

  useEffect(() => {
    const session = new RoomSession({
      onStatus: setStatus,
      onPeers: setPeers,
      onLocalStream: setLocalStream,
      onIsStartingShare: setIsStartingShare,
      onRemoteStream: (peerId, stream) => {
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
      onError: setError,
      onSessionRejected,
      onSessionReplaced,
    });

    sessionRef.current = session;

    session.start(roomId, name, token);

    return () => {
      session.stop();
      sessionRef.current = null;
    };
  }, [roomId, name, token]);

  const startSharing = (settings: ShareSettings) => sessionRef.current?.startSharing(settings);
  const stopSharing = () => sessionRef.current?.stopSharing();

  return {
    status,
    peers,
    localStream,
    isStartingShare,
    remoteStreams,
    connectionStates,
    remoteStats,
    error,
    setError,
    startSharing,
    stopSharing,
  };
}