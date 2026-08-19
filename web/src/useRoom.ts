import { useEffect, useRef, useState } from "react";
import type { Peer, ServerMessage, SignalData, SocketStatus } from "./types";

const iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

function websocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (configuredUrl) return configuredUrl;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function useRoom(roomId: string, name: string) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isStartingShare, setIsStartingShare] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectionStates, setConnectionStates] = useState<
    Record<string, RTCPeerConnectionState>
  >({});
  const [error, setError] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Peer[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingOffersRef = useRef(new Set<string>());
  const createOfferRef = useRef<(peerId: string) => Promise<void>>(async () => {});
  const stopSharingRef = useRef<() => void>(() => {});
  const sharingRequestRef = useRef<((accepted: boolean) => void) | null>(null);
  const startingShareRef = useRef(false);
  const sharingGenerationRef = useRef(0);
  const activeRef = useRef(false);

  const updatePeers = (updater: (current: Peer[]) => Peer[]) => {
    setPeers((current) => {
      const next = updater(current);
      peersRef.current = next;
      return next;
    });
  };

  const send = (message: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const closePeer = (peerId: string) => {
    const connection = peerConnectionsRef.current.get(peerId);
    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onconnectionstatechange = null;
      connection.close();
      peerConnectionsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    pendingOffersRef.current.delete(peerId);
    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
    setConnectionStates((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  };

  useEffect(() => {
    activeRef.current = true;
    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;
    setStatus("connecting");
    setError("");

    const createPeerConnection = (peerId: string) => {
      const existing = peerConnectionsRef.current.get(peerId);
      if (existing) return existing;

      const connection = new RTCPeerConnection({ iceServers });
      peerConnectionsRef.current.set(peerId, connection);
      setConnectionStates((current) => ({
        ...current,
        [peerId]: connection.connectionState,
      }));

      for (const track of localStreamRef.current?.getTracks() ?? []) {
        connection.addTrack(track, localStreamRef.current!);
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            type: "signal",
            target: peerId,
            data: { candidate: event.candidate.toJSON() },
          });
        }
      };

      connection.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          setRemoteStreams((current) => ({ ...current, [peerId]: stream }));
        }
      };

      connection.onconnectionstatechange = () => {
        setConnectionStates((current) => ({
          ...current,
          [peerId]: connection.connectionState,
        }));

        if (
          connection.connectionState === "failed" ||
          connection.connectionState === "closed"
        ) {
          closePeer(peerId);
        }
      };

      return connection;
    };

    createOfferRef.current = async (peerId: string) => {
      if (
        pendingOffersRef.current.has(peerId) ||
        !localStreamRef.current
      ) {
        return;
      }

      const generation = sharingGenerationRef.current;
      pendingOffersRef.current.add(peerId);
      try {
        const connection = createPeerConnection(peerId);
        const offer = await connection.createOffer();
        if (generation !== sharingGenerationRef.current || !localStreamRef.current) return;
        await connection.setLocalDescription(offer);
        if (generation !== sharingGenerationRef.current || !localStreamRef.current) return;
        send({ type: "signal", target: peerId, data: connection.localDescription });
      } catch {
        if (generation === sharingGenerationRef.current) {
          setError("Could not start a peer connection.");
        }
        closePeer(peerId);
      } finally {
        pendingOffersRef.current.delete(peerId);
      }
    };

    const handleSignal = async (from: string, data: SignalData) => {
      try {
        const connection = createPeerConnection(from);

        if ("candidate" in data) {
          if (connection.remoteDescription) {
            await connection.addIceCandidate(data.candidate);
          } else {
            const pending = pendingCandidatesRef.current.get(from) ?? [];
            pending.push(data.candidate);
            pendingCandidatesRef.current.set(from, pending);
          }
          return;
        }

        await connection.setRemoteDescription(data);

        for (const candidate of pendingCandidatesRef.current.get(from) ?? []) {
          await connection.addIceCandidate(candidate);
        }
        pendingCandidatesRef.current.delete(from);

        if (data.type === "offer") {
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          send({ type: "signal", target: from, data: connection.localDescription });
        }
      } catch {
        setError("WebRTC negotiation failed. Try rejoining the room.");
        closePeer(from);
      }
    };

    socket.onopen = () => {
      setStatus("connected");
      send({ type: "join", room: roomId, name });
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (message.type === "room-state") {
        updatePeers(() => message.peers);
        return;
      }

      if (message.type === "peer-joined") {
        updatePeers((current) => [
          ...current.filter((peer) => peer.id !== message.peer.id),
          message.peer,
        ]);
        if (localStreamRef.current) void createOfferRef.current(message.peer.id);
        return;
      }

      if (message.type === "peer-left") {
        closePeer(message.peerId);
        updatePeers((current) => current.filter((peer) => peer.id !== message.peerId));
        return;
      }

      if (message.type === "peer-updated") {
        updatePeers((current) =>
          current.map((peer) =>
            peer.id === message.peer.id ? message.peer : peer,
          ),
        );
        if (!message.peer.sharing) closePeer(message.peer.id);
        return;
      }

      if (message.type === "signal") {
        void handleSignal(message.from, message.data);
        return;
      }

      if (message.type === "sharing-accepted") {
        sharingRequestRef.current?.(message.sharing);
        sharingRequestRef.current = null;
        return;
      }

      if (message.type === "error") {
        setError(message.message);
        if (message.code === "SHARER_EXISTS") {
          sharingRequestRef.current?.(false);
          sharingRequestRef.current = null;
        }
      }
    };

    socket.onclose = () => {
      setStatus("disconnected");
      stopSharingRef.current();
    };
    socket.onerror = () => setError("Could not reach the signaling server.");

    return () => {
      activeRef.current = false;
      sharingGenerationRef.current += 1;
      sharingRequestRef.current?.(false);
      sharingRequestRef.current = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
      socketRef.current = null;
      for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
      localStreamRef.current = null;
      for (const peerId of peerConnectionsRef.current.keys()) closePeer(peerId);
      peersRef.current = [];
    };
  }, [roomId, name]);

  const stopSharing = () => {
    const stream = localStreamRef.current;
    sharingGenerationRef.current += 1;
    sharingRequestRef.current?.(false);
    sharingRequestRef.current = null;
    startingShareRef.current = false;
    setIsStartingShare(false);
    for (const track of stream?.getTracks() ?? []) track.stop();
    localStreamRef.current = null;
    setLocalStream(null);
    for (const peerId of peerConnectionsRef.current.keys()) closePeer(peerId);
    if (stream) send({ type: "sharing", sharing: false });
  };
  stopSharingRef.current = stopSharing;

  const startSharing = async () => {
    if (
      startingShareRef.current ||
      localStreamRef.current ||
      peersRef.current.some((peer) => peer.sharing) ||
      socketRef.current?.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const generation = sharingGenerationRef.current + 1;
    sharingGenerationRef.current = generation;
    startingShareRef.current = true;
    setIsStartingShare(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: true,
      });

      if (!activeRef.current || generation !== sharingGenerationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const accepted = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          sharingRequestRef.current = null;
          setError("The signaling server did not respond to the share request.");
          resolve(false);
        }, 5000);
        sharingRequestRef.current = (granted) => {
          window.clearTimeout(timeout);
          resolve(granted);
        };
        send({ type: "sharing", sharing: true });
      });

      if (!accepted || !activeRef.current || generation !== sharingGenerationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        if (!accepted && activeRef.current) send({ type: "sharing", sharing: false });
        return;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopSharing, {
        once: true,
      });

      for (const peer of peersRef.current) {
        if (generation !== sharingGenerationRef.current) break;
        await createOfferRef.current(peer.id);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotAllowedError") return;
      setError("Screen capture could not be started.");
      for (const track of stream?.getTracks() ?? []) track.stop();
    } finally {
      if (generation === sharingGenerationRef.current) {
        startingShareRef.current = false;
        setIsStartingShare(false);
      }
    }
  };

  return {
    status,
    peers,
    localStream,
    isStartingShare,
    remoteStreams,
    connectionStates,
    error,
    setError,
    startSharing,
    stopSharing,
  };
}
