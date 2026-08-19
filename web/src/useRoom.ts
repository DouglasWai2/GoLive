import { useEffect, useRef, useState } from "react";
import type {
  Peer,
  ServerMessage,
  SignalData,
  SocketStatus,
} from "./types";

const fallbackIceServers: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
    ],
  },
];

function signalingHttpUrl(path: string): string {
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL as
    | string
    | undefined;

  const url = new URL(configuredUrl ?? window.location.origin);

  // In case VITE_SIGNALING_URL was configured as ws/wss.
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  }

  if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = path;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function websocketUrl(): string {
  const url = new URL(signalingHttpUrl("/ws"));

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return url.toString();
}

async function getIceServers(): Promise<RTCIceServer[]> {
  const response = await fetch(
    signalingHttpUrl("/turn-credentials"),
  );

  if (!response.ok) {
    throw new Error(
      `Failed to get TURN credentials: ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    iceServers?: RTCIceServer[];
  };

  if (!Array.isArray(data.iceServers)) {
    throw new Error(
      "TURN credentials response did not contain iceServers",
    );
  }

  return data.iceServers;
}

export function useRoom(roomId: string, name: string) {
  const [status, setStatus] =
    useState<SocketStatus>("connecting");

  const [peers, setPeers] = useState<Peer[]>([]);

  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [isStartingShare, setIsStartingShare] =
    useState(false);

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});

  const [connectionStates, setConnectionStates] =
    useState<Record<string, RTCPeerConnectionState>>({});

  const [error, setError] = useState("");

  /*
   * Refs
   */

  const socketRef = useRef<WebSocket | null>(null);

  const iceServersRef =
    useRef<RTCIceServer[]>(fallbackIceServers);

  const peersRef = useRef<Peer[]>([]);

  const localStreamRef =
    useRef<MediaStream | null>(null);

  const peerConnectionsRef = useRef(
    new Map<string, RTCPeerConnection>(),
  );

  const pendingCandidatesRef = useRef(
    new Map<string, RTCIceCandidateInit[]>(),
  );

  const pendingOffersRef = useRef(new Set<string>());

  const createOfferRef = useRef<
    (peerId: string) => Promise<void>
  >(async () => {});

  const stopSharingRef =
    useRef<() => void>(() => {});

  const sharingRequestRef = useRef<
    ((accepted: boolean) => void) | null
  >(null);

  const startingShareRef = useRef(false);

  const sharingGenerationRef = useRef(0);

  const activeRef = useRef(false);

  /*
   * Helpers
   */
   async function logSelectedIceRoute(
     peerId: string,
     connection: RTCPeerConnection,
   ) {
     const stats = await connection.getStats();
   
     let selectedPair: any = null;
   
     /*
      * Preferred modern method:
      * transport -> selectedCandidatePairId
      */
     stats.forEach((report) => {
       if (
         report.type === "transport" &&
         report.selectedCandidatePairId
       ) {
         selectedPair = stats.get(
           report.selectedCandidatePairId,
         );
       }
     });
   
     /*
      * Fallback for browsers where the transport
      * stat doesn't expose selectedCandidatePairId.
      */
     if (!selectedPair) {
       stats.forEach((report) => {
         if (
           report.type === "candidate-pair" &&
           report.state === "succeeded" &&
           report.nominated
         ) {
           selectedPair = report;
         }
       });
     }
   
     if (!selectedPair) {
       console.warn(
         `[${peerId}] No selected ICE pair found`,
       );
   
       return;
     }
   
     const localCandidate = stats.get(
       selectedPair.localCandidateId,
     ) as any;
   
     const remoteCandidate = stats.get(
       selectedPair.remoteCandidateId,
     ) as any;
   
     const localType =
       localCandidate?.candidateType;
   
     const remoteType =
       remoteCandidate?.candidateType;
   
     const usingTurn =
       localType === "relay" ||
       remoteType === "relay";
   
     const usingStun =
       !usingTurn &&
       (
         localType === "srflx" ||
         remoteType === "srflx"
       );
   
     const route = usingTurn
       ? "TURN relay"
       : usingStun
         ? "Direct P2P via STUN"
         : "Direct P2P";
   
     console.log(
       `[${peerId}] ICE ROUTE: ${route}`,
       {
         localType,
         remoteType,
         protocol:
           localCandidate?.protocol,
         localAddress:
           localCandidate?.address,
         remoteAddress:
           remoteCandidate?.address,
         rtt:
           selectedPair.currentRoundTripTime,
       },
     );
   }

   async function configureVideoSender(
     sender: RTCRtpSender,
     {
       maxBitrate,
       maxFramerate,
       scaleResolutionDownBy = 1,
     }: {
       maxBitrate: number;
       maxFramerate: number;
       scaleResolutionDownBy?: number;
     },
   ) {
     const parameters =
       sender.getParameters();
   
     if (!parameters.encodings.length) {
       console.warn(
         "Video sender has no encodings yet",
       );
   
       return;
     }
   
     for (
       const encoding of parameters.encodings
     ) {
       encoding.maxBitrate = maxBitrate;
   
       encoding.maxFramerate =
         maxFramerate;
   
       encoding.scaleResolutionDownBy =
         scaleResolutionDownBy;
     }
   
     await sender.setParameters(
       parameters,
     );
   }
  
  const updatePeers = (
    updater: (current: Peer[]) => Peer[],
  ) => {
    setPeers((current) => {
      const next = updater(current);

      peersRef.current = next;

      return next;
    });
  };

  const send = (message: unknown) => {
    const socket = socketRef.current;

    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  };

  const closePeer = (peerId: string) => {
    const connection =
      peerConnectionsRef.current.get(peerId);

    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onicecandidateerror = null;
      connection.oniceconnectionstatechange = null;
      connection.onicegatheringstatechange = null;
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

  /*
   * WebSocket + WebRTC lifecycle
   */

   useEffect(() => {
     /*
      * IMPORTANT:
      *
      * `cancelled` belongs to THIS specific effect execution.
      * Do not rely only on activeRef here because React StrictMode
      * can:
      *
      *   effect #1 starts
      *   cleanup #1
      *   effect #2 starts
      *   async work from #1 finishes later
      *
      * activeRef would already be true again because effect #2
      * started. `cancelled` prevents effect #1 from continuing.
      */
     let cancelled = false;
     let socket: WebSocket | null = null;
   
     activeRef.current = true;
   
     setStatus("connecting");
     setError("");
   
     /*
      * Each peer gets its own signaling promise chain.
      *
      * WebSocket messages arrive in order, but async handlers don't
      * necessarily FINISH in order.
      *
      * Without serialization:
      *
      *   answer #1 -> setRemoteDescription()
      *   answer #2 -> setRemoteDescription()
      *
      * can overlap and produce:
      *
      *   Called in wrong state: stable
      */
     const signalQueues = new Map<string, Promise<void>>();
   
     const createPeerConnection = (
       peerId: string,
     ): RTCPeerConnection => {
       const existing =
         peerConnectionsRef.current.get(peerId);
   
       if (
         existing &&
         existing.signalingState !== "closed"
       ) {
         return existing;
       }
   
       if (existing) {
         peerConnectionsRef.current.delete(peerId);
       }
   
       console.log(
         `[${peerId}] Creating peer connection`,
         {
           iceServers: iceServersRef.current,
         },
       );
   
       const connection = new RTCPeerConnection({
         iceServers: iceServersRef.current,
       });
   
       peerConnectionsRef.current.set(
         peerId,
         connection,
       );
   
       setConnectionStates((current) => ({
         ...current,
         [peerId]: connection.connectionState,
       }));
   
       /*
        * If we're already sharing when a peer joins,
        * attach the existing screen/audio tracks.
        */
       const localStream = localStreamRef.current;
   
       if (localStream) {
         for (const track of localStream.getTracks()) {
           connection.addTrack(
             track,
             localStream,
           );
         }
       }
   
       /*
        * Send ALL locally generated ICE candidates
        * through our signaling WebSocket.
        */
       connection.onicecandidate = (event) => {
         if (!event.candidate) {
           console.log(
             `[${peerId}] ICE candidate gathering finished`,
           );
   
           return;
         }
   
         console.log(
           `[${peerId}] ICE candidate`,
           {
             type: event.candidate.type,
             protocol: event.candidate.protocol,
             address: event.candidate.address,
             port: event.candidate.port,
           },
         );
   
         send({
           type: "signal",
           target: peerId,
           data: {
             candidate:
               event.candidate.toJSON(),
           },
         });
       };
   
       /*
        * ICE errors are diagnostic.
        *
        * For example, a 701 on IPv6 does NOT necessarily
        * mean the entire connection failed if IPv4 succeeds.
        */
       connection.onicecandidateerror = (
         event,
       ) => {
         console.warn(
           `[${peerId}] ICE candidate error`,
           {
             url: event.url,
             address: event.address,
             port: event.port,
             errorCode: event.errorCode,
             errorText: event.errorText,
           },
         );
       };
   
       connection.oniceconnectionstatechange =
         () => {
           console.log(
             `[${peerId}] ICE connection:`,
             connection.iceConnectionState,
           );
         };
   
       connection.onicegatheringstatechange =
         () => {
           console.log(
             `[${peerId}] ICE gathering:`,
             connection.iceGatheringState,
           );
         };
   
       connection.onsignalingstatechange =
         () => {
           console.log(
             `[${peerId}] Signaling:`,
             connection.signalingState,
           );
         };
   
       /*
        * Remote screen/audio stream.
        */
       connection.ontrack = (event) => {
         const [stream] = event.streams;
   
         if (!stream) {
           console.warn(
             `[${peerId}] Track received without MediaStream`,
           );
   
           return;
         }
   
         console.log(
           `[${peerId}] Remote stream received`,
           {
             streamId: stream.id,
             tracks: stream
               .getTracks()
               .map((track) => ({
                 id: track.id,
                 kind: track.kind,
                 enabled: track.enabled,
                 readyState: track.readyState,
               })),
           },
         );
   
         setRemoteStreams((current) => ({
           ...current,
           [peerId]: stream,
         }));
       };
   
       connection.onconnectionstatechange = () => {
         console.log(
           `[${peerId}] Connection:`,
           connection.connectionState,
         );
       
         setConnectionStates((current) => ({
           ...current,
           [peerId]: connection.connectionState,
         }));
       
         if (
           connection.connectionState === "connected"
         ) {
           void logSelectedIceRoute(
             peerId,
             connection,
           );
         }
       
         if (
           connection.connectionState === "closed"
         ) {
           closePeer(peerId);
         }
       
         if (
           connection.connectionState === "failed"
         ) {
           console.error(
             `[${peerId}] Peer connection failed`,
           );
         }
       };
   
       return connection;
     };
   
     /*
      * Candidates may arrive before the remote SDP.
      *
      * addIceCandidate() cannot safely be called until
      * remoteDescription exists.
      */
     const addOrQueueCandidate = async (
       peerId: string,
       connection: RTCPeerConnection,
       candidate: RTCIceCandidateInit,
     ) => {
       if (
         connection.signalingState === "closed"
       ) {
         return;
       }
   
       if (connection.remoteDescription) {
         try {
           await connection.addIceCandidate(
             candidate,
           );
         } catch (caught) {
           console.error(
             `[${peerId}] addIceCandidate failed`,
             caught,
           );
         }
   
         return;
       }
   
       const pending =
         pendingCandidatesRef.current.get(
           peerId,
         ) ?? [];
   
       pending.push(candidate);
   
       pendingCandidatesRef.current.set(
         peerId,
         pending,
       );
     };
   
     const flushCandidates = async (
       peerId: string,
       connection: RTCPeerConnection,
     ) => {
       const pending =
         pendingCandidatesRef.current.get(
           peerId,
         ) ?? [];
   
       pendingCandidatesRef.current.delete(
         peerId,
       );
   
       for (const candidate of pending) {
         if (
           connection.signalingState ===
           "closed"
         ) {
           return;
         }
   
         try {
           await connection.addIceCandidate(
             candidate,
           );
         } catch (caught) {
           console.error(
             `[${peerId}] Queued addIceCandidate failed`,
             caught,
           );
         }
       }
     };
   
     /*
      * The screen sharer creates an offer for each peer.
      */
     createOfferRef.current = async (
       peerId: string,
     ) => {
       if (
         cancelled ||
         pendingOffersRef.current.has(peerId) ||
         !localStreamRef.current
       ) {
         return;
       }
   
       const generation =
         sharingGenerationRef.current;
   
       pendingOffersRef.current.add(peerId);
   
       try {
         const connection =
           createPeerConnection(peerId);
   
         /*
          * We should only create a fresh offer while stable.
          */
         if (
           connection.signalingState !==
           "stable"
         ) {
           console.warn(
             `[${peerId}] Cannot create offer in signaling state`,
             connection.signalingState,
           );
   
           return;
         }
   
         const offer =
           await connection.createOffer();
   
         if (
           cancelled ||
           generation !==
             sharingGenerationRef.current ||
           !localStreamRef.current
         ) {
           return;
         }
   
         await connection.setLocalDescription(
           offer,
         );
   
         if (
           cancelled ||
           generation !==
             sharingGenerationRef.current ||
           !localStreamRef.current
         ) {
           return;
         }
   
         console.log(
           `[${peerId}] Sending offer`,
         );
   
         send({
           type: "signal",
           target: peerId,
           data: connection.localDescription,
         });
       } catch (caught) {
         console.error(
           `[${peerId}] Could not create offer`,
           caught,
         );
   
         if (
           !cancelled &&
           generation ===
             sharingGenerationRef.current
         ) {
           setError(
             "Could not start a peer connection.",
           );
         }
   
         closePeer(peerId);
       } finally {
         pendingOffersRef.current.delete(
           peerId,
         );
       }
     };
   
     /*
      * Actually process ONE signaling message.
      *
      * These calls will be serialized per peer by
      * enqueueSignal() below.
      */
     const processSignal = async (
       from: string,
       data: SignalData,
     ) => {
       if (cancelled) {
         return;
       }
   
       const connection =
         createPeerConnection(from);
   
       /*
        * ICE candidate
        */
       if ("candidate" in data) {
         await addOrQueueCandidate(
           from,
           connection,
           data.candidate,
         );
   
         return;
       }
   
       /*
        * SDP ANSWER
        *
        * An answer is only valid if we previously created
        * an offer and are currently waiting for its answer.
        */
       if (data.type === "answer") {
         if (
           connection.signalingState !==
           "have-local-offer"
         ) {
           console.warn(
             `[${from}] Ignoring stale/duplicate answer`,
             {
               signalingState:
                 connection.signalingState,
             },
           );
   
           return;
         }
   
         console.log(
           `[${from}] Applying answer`,
         );
   
         await connection.setRemoteDescription(
           data,
         );
   
         await flushCandidates(
           from,
           connection,
         );
   
         return;
       }
   
       /*
        * SDP OFFER
        *
        * In our architecture the screen sharer creates offers
        * and viewers normally answer them.
        */
       if (data.type === "offer") {
         if (
           connection.signalingState !==
           "stable"
         ) {
           console.warn(
             `[${from}] Ignoring offer in unexpected state`,
             {
               signalingState:
                 connection.signalingState,
             },
           );
   
           return;
         }
   
         console.log(
           `[${from}] Applying offer`,
         );
   
         await connection.setRemoteDescription(
           data,
         );
   
         await flushCandidates(
           from,
           connection,
         );
   
         const answer =
           await connection.createAnswer();
   
         await connection.setLocalDescription(
           answer,
         );
   
         console.log(
           `[${from}] Sending answer`,
         );
   
         send({
           type: "signal",
           target: from,
           data: connection.localDescription,
         });
       }
     };
   
     /*
      * Serialize signaling operations for EACH peer.
      *
      * This is critical.
      *
      * Before:
      *
      *   void handleSignal(message1)
      *   void handleSignal(message2)
      *
      * Both could manipulate the same RTCPeerConnection
      * simultaneously.
      *
      * Now:
      *
      *   message1
      *      ↓ await
      *   message2
      *      ↓ await
      *   message3
      */
     const enqueueSignal = (
       from: string,
       data: SignalData,
     ) => {
       const previous =
         signalQueues.get(from) ??
         Promise.resolve();
   
       const next = previous
         .catch(() => {
           /*
            * Don't permanently break the queue if an
            * earlier message failed.
            */
         })
         .then(async () => {
           if (cancelled) {
             return;
           }
   
           try {
             await processSignal(
               from,
               data,
             );
           } catch (caught) {
             console.error(
               `[${from}] WebRTC negotiation failed`,
               caught,
             );
   
             if (!cancelled) {
               setError(
                 "WebRTC negotiation failed. Try rejoining the room.",
               );
             }
           }
         });
   
       signalQueues.set(from, next);
   
       void next.finally(() => {
         if (
           signalQueues.get(from) === next
         ) {
           signalQueues.delete(from);
         }
       });
     };
   
     /*
      * WebSocket messages from Fastify.
      */
     const handleSocketMessage = (
       event: MessageEvent,
     ) => {
       if (cancelled) {
         return;
       }
   
       let message: ServerMessage;
   
       try {
         message = JSON.parse(
           event.data as string,
         ) as ServerMessage;
       } catch (caught) {
         console.warn(
           "Ignoring invalid signaling message",
           caught,
         );
   
         return;
       }
   
       if (message.type === "room-state") {
         updatePeers(
           () => message.peers,
         );
   
         return;
       }
   
       if (message.type === "peer-joined") {
         updatePeers((current) => [
           ...current.filter(
             (peer) =>
               peer.id !== message.peer.id,
           ),
           message.peer,
         ]);
   
         /*
          * If we're currently sharing, the new viewer
          * immediately gets an offer.
          */
         if (localStreamRef.current) {
           void createOfferRef.current(
             message.peer.id,
           );
         }
   
         return;
       }
   
       if (message.type === "peer-left") {
         signalQueues.delete(
           message.peerId,
         );
   
         closePeer(message.peerId);
   
         updatePeers((current) =>
           current.filter(
             (peer) =>
               peer.id !== message.peerId,
           ),
         );
   
         return;
       }
   
       if (
         message.type ===
         "peer-updated"
       ) {
         updatePeers((current) =>
           current.map((peer) =>
             peer.id === message.peer.id
               ? message.peer
               : peer,
           ),
         );
   
         if (!message.peer.sharing) {
           signalQueues.delete(
             message.peer.id,
           );
   
           closePeer(message.peer.id);
         }
   
         return;
       }
   
       if (message.type === "signal") {
         enqueueSignal(
           message.from,
           message.data,
         );
   
         return;
       }
   
       if (
         message.type ===
         "sharing-accepted"
       ) {
         sharingRequestRef.current?.(
           message.sharing,
         );
   
         sharingRequestRef.current =
           null;
   
         return;
       }
   
       if (message.type === "error") {
         setError(message.message);
   
         if (
           message.code ===
           "SHARER_EXISTS"
         ) {
           sharingRequestRef.current?.(
             false,
           );
   
           sharingRequestRef.current =
             null;
         }
       }
     };
   
     /*
      * Initialization:
      *
      *   1. Get Cloudflare STUN/TURN credentials
      *   2. Only THEN connect to Fastify WebSocket
      *   3. Only THEN join the room
      *
      * This guarantees every RTCPeerConnection has TURN
      * available from the beginning.
      */
     const initialize = async () => {
       let resolvedIceServers:
         RTCIceServer[];
   
       try {
         resolvedIceServers =
           await getIceServers();
   
         console.log(
           "Cloudflare ICE servers loaded",
           resolvedIceServers,
         );
       } catch (caught) {
         console.warn(
           "Could not load TURN credentials. Falling back to STUN only.",
           caught,
         );
   
         resolvedIceServers =
           fallbackIceServers;
       }
   
       /*
        * This check MUST use the local `cancelled`
        * variable.
        *
        * activeRef alone is not safe against React
        * StrictMode async initialization races.
        */
       if (cancelled) {
         return;
       }
   
       iceServersRef.current =
         resolvedIceServers;
   
       const ws = new WebSocket(
         websocketUrl(),
       );
   
       /*
        * The effect could theoretically be cleaned up
        * between constructing WebSocket and assigning it.
        */
       if (cancelled) {
         ws.close();
   
         return;
       }
   
       socket = ws;
       socketRef.current = ws;
   
       ws.onopen = () => {
         if (
           cancelled ||
           socketRef.current !== ws
         ) {
           return;
         }
   
         console.log(
           "Signaling WebSocket connected",
         );
   
         setStatus("connected");
   
         /*
          * Use this exact WebSocket instead of `send()`
          * for the initial join, preventing any stale
          * socketRef race.
          */
         ws.send(
           JSON.stringify({
             type: "join",
             room: roomId,
             name,
           }),
         );
       };
   
       ws.onmessage =
         handleSocketMessage;
   
       ws.onclose = () => {
         if (
           cancelled ||
           socketRef.current !== ws
         ) {
           return;
         }
   
         console.log(
           "Signaling WebSocket disconnected",
         );
   
         setStatus("disconnected");
   
         stopSharingRef.current();
       };
   
       ws.onerror = (event) => {
         console.error(
           "Signaling WebSocket error",
           event,
         );
   
         if (
           cancelled ||
           socketRef.current !== ws
         ) {
           return;
         }
   
         setError(
           "Could not reach the signaling server.",
         );
       };
     };
   
     void initialize();
   
     /*
      * Cleanup
      */
     return () => {
       /*
        * This is the most important StrictMode guard.
        * Any async initialize() belonging to THIS effect
        * can no longer continue.
        */
       cancelled = true;
   
       activeRef.current = false;
   
       sharingGenerationRef.current += 1;
   
       sharingRequestRef.current?.(
         false,
       );
   
       sharingRequestRef.current = null;
   
       /*
        * Prevent queued signaling work from starting.
        */
       signalQueues.clear();
   
       /*
        * Only clean socketRef if it still belongs to this
        * particular effect execution.
        */
       if (
         socket &&
         socketRef.current === socket
       ) {
         socketRef.current = null;
       }
   
       if (socket) {
         socket.onopen = null;
         socket.onclose = null;
         socket.onmessage = null;
         socket.onerror = null;
   
         socket.close();
       }
   
       /*
        * Stop current screen/audio capture.
        */
       for (
         const track of
         localStreamRef.current?.getTracks() ??
         []
       ) {
         
         track.stop();
       }
   
       localStreamRef.current = null;
   
       /*
        * Close all WebRTC connections.
        *
        * Array.from() is intentional because closePeer()
        * mutates the Map we're iterating over.
        */
       for (
         const peerId of Array.from(
           peerConnectionsRef.current.keys(),
         )
       ) {
         closePeer(peerId);
       }
   
       pendingCandidatesRef.current.clear();
       pendingOffersRef.current.clear();
   
       peersRef.current = [];
     };
   }, [roomId, name]);

  /*
   * Stop screen sharing.
   */
  const stopSharing = () => {
    const stream =
      localStreamRef.current;

    sharingGenerationRef.current += 1;

    sharingRequestRef.current?.(false);
    sharingRequestRef.current = null;

    startingShareRef.current = false;

    setIsStartingShare(false);

    for (
      const track of stream?.getTracks() ?? []
    ) {
      track.stop();
    }

    localStreamRef.current = null;

    setLocalStream(null);

    for (
      const peerId of Array.from(
        peerConnectionsRef.current.keys(),
      )
    ) {
      closePeer(peerId);
    }

    if (stream) {
      send({
        type: "sharing",
        sharing: false,
      });
    }
  };

  stopSharingRef.current = stopSharing;

  /*
   * Start screen sharing.
   */
  const startSharing = async () => {
    if (
      startingShareRef.current ||
      localStreamRef.current ||
      peersRef.current.some(
        (peer) => peer.sharing,
      ) ||
      socketRef.current?.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    const generation =
      sharingGenerationRef.current + 1;

    sharingGenerationRef.current =
      generation;

    startingShareRef.current = true;

    setIsStartingShare(true);
    setError("");

    let stream: MediaStream | null = null;

    try {
      stream =
        await navigator.mediaDevices.getDisplayMedia(
          {
            video: {
              frameRate: {
                ideal: 30,
                max: 60,
              },
            },
            audio: true,
          },
        );

      if (
        !activeRef.current ||
        generation !==
          sharingGenerationRef.current
      ) {
        for (const track of stream.getTracks()) {
          track.stop();
        }

        return;
      }

      /*
       * Ask signaling server whether we're
       * allowed to become this room's sharer.
       */
      const accepted =
        await new Promise<boolean>(
          (resolve) => {
            const timeout =
              window.setTimeout(() => {
                sharingRequestRef.current =
                  null;

                setError(
                  "The signaling server did not respond to the share request.",
                );

                resolve(false);
              }, 5000);

            sharingRequestRef.current = (
              granted,
            ) => {
              window.clearTimeout(timeout);

              resolve(granted);
            };

            send({
              type: "sharing",
              sharing: true,
            });
          },
        );

      if (
        !accepted ||
        !activeRef.current ||
        generation !==
          sharingGenerationRef.current
      ) {
        for (const track of stream.getTracks()) {
          track.stop();
        }

        if (
          !accepted &&
          activeRef.current
        ) {
          send({
            type: "sharing",
            sharing: false,
          });
        }

        return;
      }

      localStreamRef.current = stream;

      setLocalStream(stream);

      /*
       * Browser's native "Stop sharing" button.
       */
      stream
        .getVideoTracks()[0]
        ?.addEventListener(
          "ended",
          () => {
            stopSharingRef.current();
          },
          {
            once: true,
          },
        );

      /*
       * Create one P2P connection for each
       * peer already in the room.
       */
      for (const peer of peersRef.current) {
        if (
          generation !==
          sharingGenerationRef.current
        ) {
          break;
        }

        await createOfferRef.current(
          peer.id,
        );
      }
    } catch (caught) {
      if (
        caught instanceof DOMException &&
        caught.name === "NotAllowedError"
      ) {
        return;
      }

      console.error(
        "Screen capture failed",
        caught,
      );

      setError(
        "Screen capture could not be started.",
      );

      for (
        const track of
        stream?.getTracks() ?? []
      ) {
        track.stop();
      }
    } finally {
      if (
        generation ===
        sharingGenerationRef.current
      ) {
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