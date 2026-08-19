import { useEffect, useRef, useState } from "react";
import type { Peer, ServerMessage, SignalData, SocketStatus } from "./types";

const iceServers: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
      "stun1.l.google.com:19302",
      "stun1.voiceeclipse.net:3478",
      "stun2.l.google.com:19302",
      "stun3.l.google.com:19302",
      "stun4.l.google.com:19302",
      "stun:stunserver.stunprotocol.org:3478",
      "iphone-stun.strato-iphone.de:3478",
      "numb.viagenie.ca:3478",
      "s1.taraba.net:3478",
      "s2.taraba.net:3478",
      "stun.12connect.com:3478",
      "stun.12voip.com:3478",
      "stun.1und1.de:3478",
      "stun.2talk.co.nz:3478",
      "stun.2talk.com:3478",
      "stun.3clogic.com:3478",
      "stun.3cx.com:3478",
      "stun.a-mm.tv:3478",
      "stun.aa.net.uk:3478",
      "stun.acrobits.cz:3478",
      "stun.actionvoip.com:3478",
      "stun.advfn.com:3478",
      "stun.aeta-audio.com:3478",
      "stun.aeta.com:3478",
      "stun.alltel.com.au:3478",
      "stun.altar.com.pl:3478",
      "stun.annatel.net:3478",
      "stun.antisip.com:3478",
      "stun.arbuz.ru:3478",
      "stun.avigora.com:3478",
      "stun.avigora.fr:3478",
      "stun.awa-shima.com:3478",
      "stun.awt.be:3478",
      "stun.b2b2c.ca:3478",
      "stun.bahnhof.net:3478",
      "stun.barracuda.com:3478",
      "stun.bluesip.net:3478",
      "stun.bmwgs.cz:3478",
      "stun.botonakis.com:3478",
      "stun.budgetphone.nl:3478",
      "stun.budgetsip.com:3478",
      "stun.cablenet-as.net:3478",
      "stun.callromania.ro:3478",
      "stun.callwithus.com:3478",
      "stun.cbsys.net:3478",
      "stun.chathelp.ru:3478",
      "stun.cheapvoip.com:3478",
      "stun.ciktel.com:3478",
      "stun.cloopen.com:3478",
      "stun.colouredlines.com.au:3478",
      "stun.comfi.com:3478",
      "stun.commpeak.com:3478",
      "stun.comtube.com:3478",
      "stun.comtube.ru:3478",
      "stun.cope.es:3478",
      "stun.counterpath.com:3478",
      "stun.counterpath.net:3478",
      "stun.cryptonit.net:3478",
      "stun.darioflaccovio.it:3478",
      "stun.datamanagement.it:3478",
      "stun.dcalling.de:3478",
      "stun.decanet.fr:3478",
      "stun.demos.ru:3478",
      "stun.develz.org:3478",
      "stun.dingaling.ca:3478",
      "stun.doublerobotics.com:3478",
      "stun.drogon.net:3478",
      "stun.duocom.es:3478",
      "stun.dus.net:3478",
      "stun.e-fon.ch:3478",
      "stun.easybell.de:3478",
      "stun.easycall.pl:3478",
      "stun.easyvoip.com:3478",
      "stun.efficace-factory.com:3478",
      "stun.einsundeins.com:3478",
      "stun.einsundeins.de:3478",
      "stun.ekiga.net:3478",
      "stun.epygi.com:3478",
      "stun.etoilediese.fr:3478",
      "stun.eyeball.com:3478",
      "stun.faktortel.com.au:3478",
      "stun.freecall.com:3478",
      "stun.freeswitch.org:3478",
      "stun.freevoipdeal.com:3478",
      "stun.fuzemeeting.com:3478",
      "stun.gmx.de:3478",
      "stun.gmx.net:3478",
      "stun.gradwell.com:3478",
      "stun.halonet.pl:3478",
      "stun.hellonanu.com:3478",
      "stun.hoiio.com:3478",
      "stun.hosteurope.de:3478",
      "stun.ideasip.com:3478",
      "stun.imesh.com:3478",
      "stun.infra.net:3478",
      "stun.internetcalls.com:3478",
      "stun.intervoip.com:3478",
      "stun.ipcomms.net:3478",
      "stun.ipfire.org:3478",
      "stun.ippi.fr:3478",
      "stun.ipshka.com:3478",
      "stun.iptel.org:3478",
      "stun.irian.at:3478",
      "stun.it1.hr:3478",
      "stun.ivao.aero:3478",
      "stun.jappix.com:3478",
      "stun.jumblo.com:3478",
      "stun.justvoip.com:3478",
      "stun.kanet.ru:3478",
      "stun.kiwilink.co.nz:3478",
      "stun.kundenserver.de:3478",
      "stun.l.google.com:19302",
      "stun.linea7.net:3478",
      "stun.linphone.org:3478",
      "stun.liveo.fr:3478",
      "stun.lowratevoip.com:3478",
      "stun.lugosoft.com:3478",
      "stun.lundimatin.fr:3478",
      "stun.magnet.ie:3478",
      "stun.manle.com:3478",
      "stun.mgn.ru:3478",
      "stun.mit.de:3478",
      "stun.mitake.com.tw:3478",
      "stun.miwifi.com:3478",
      "stun.modulus.gr:3478",
      "stun.mozcom.com:3478",
      "stun.myvoiptraffic.com:3478",
      "stun.mywatson.it:3478",
      "stun.nas.net:3478",
      "stun.neotel.co.za:3478",
      "stun.netappel.com:3478",
      "stun.netappel.fr:3478",
      "stun.netgsm.com.tr:3478",
      "stun.nfon.net:3478",
      "stun.noblogs.org:3478",
      "stun.noc.ams-ix.net:3478",
      "stun.node4.co.uk:3478",
      "stun.nonoh.net:3478",
      "stun.nottingham.ac.uk:3478",
      "stun.nova.is:3478",
      "stun.nventure.com:3478",
      "stun.on.net.mk:3478",
      "stun.ooma.com:3478",
      "stun.ooonet.ru:3478",
      "stun.oriontelekom.rs:3478",
      "stun.outland-net.de:3478",
      "stun.ozekiphone.com:3478",
      "stun.patlive.com:3478",
      "stun.personal-voip.de:3478",
      "stun.petcube.com:3478",
      "stun.phone.com:3478",
      "stun.phoneserve.com:3478",
      "stun.pjsip.org:3478",
      "stun.poivy.com:3478",
      "stun.powerpbx.org:3478",
      "stun.powervoip.com:3478",
      "stun.ppdi.com:3478",
      "stun.prizee.com:3478",
      "stun.qq.com:3478",
      "stun.qvod.com:3478",
      "stun.rackco.com:3478",
      "stun.rapidnet.de:3478",
      "stun.rb-net.com:3478",
      "stun.refint.net:3478",
      "stun.remote-learner.net:3478",
      "stun.rixtelecom.se:3478",
      "stun.rockenstein.de:3478",
      "stun.rolmail.net:3478",
      "stun.rounds.com:3478",
      "stun.rynga.com:3478",
      "stun.samsungsmartcam.com:3478",
      "stun.schlund.de:3478",
      "stun.services.mozilla.com:3478",
      "stun.sigmavoip.com:3478",
      "stun.sip.us:3478",
      "stun.sipdiscount.com:3478",
      "stun.siplogin.de:3478",
      "stun.sipnet.net:3478",
      "stun.sipnet.ru:3478",
      "stun.siportal.it:3478",
      "stun.sippeer.dk:3478",
      "stun.siptraffic.com:3478",
      "stun.skylink.ru:3478",
      "stun.sma.de:3478",
      "stun.smartvoip.com:3478",
      "stun.smsdiscount.com:3478",
      "stun.snafu.de:3478",
      "stun.softjoys.com:3478",
      "stun.solcon.nl:3478",
      "stun.solnet.ch:3478",
      "stun.sonetel.com:3478",
      "stun.sonetel.net:3478",
      "stun.sovtest.ru:3478",
      "stun.speedy.com.ar:3478",
      "stun.spokn.com:3478",
      "stun.srce.hr:3478",
      "stun.ssl7.net:3478",
      "stun.stunprotocol.org:3478",
      "stun.symform.com:3478",
      "stun.symplicity.com:3478",
      "stun.sysadminman.net:3478",
      "stun.t-online.de:3478",
      "stun.tagan.ru:3478",
      "stun.tatneft.ru:3478",
      "stun.teachercreated.com:3478",
      "stun.tel.lu:3478",
      "stun.telbo.com:3478",
      "stun.telefacil.com:3478",
      "stun.tis-dialog.ru:3478",
      "stun.tng.de:3478",
      "stun.twt.it:3478",
      "stun.u-blox.com:3478",
      "stun.ucallweconn.net:3478",
      "stun.ucsb.edu:3478",
      "stun.ucw.cz:3478",
      "stun.uls.co.za:3478",
      "stun.unseen.is:3478",
      "stun.usfamily.net:3478",
      "stun.veoh.com:3478",
      "stun.vidyo.com:3478",
      "stun.vipgroup.net:3478",
      "stun.virtual-call.com:3478",
      "stun.viva.gr:3478",
      "stun.vivox.com:3478",
      "stun.vline.com:3478",
      "stun.vo.lu:3478",
      "stun.vodafone.ro:3478",
      "stun.voicetrading.com:3478",
      "stun.voip.aebc.com:3478",
      "stun.voip.blackberry.com:3478",
      "stun.voip.eutelia.it:3478",
      "stun.voiparound.com:3478",
      "stun.voipblast.com:3478",
      "stun.voipbuster.com:3478",
      "stun.voipbusterpro.com:3478",
      "stun.voipcheap.co.uk:3478",
      "stun.voipcheap.com:3478",
      "stun.voipfibre.com:3478",
      "stun.voipgain.com:3478",
      "stun.voipgate.com:3478",
      "stun.voipinfocenter.com:3478",
      "stun.voipplanet.nl:3478",
      "stun.voippro.com:3478",
      "stun.voipraider.com:3478",
      "stun.voipstunt.com:3478",
      "stun.voipwise.com:3478",
      "stun.voipzoom.com:3478",
      "stun.vopium.com:3478",
      "stun.voxgratia.org:3478",
      "stun.voxox.com:3478",
      "stun.voys.nl:3478",
      "stun.voztele.com:3478",
      "stun.vyke.com:3478",
      "stun.webcalldirect.com:3478",
      "stun.whoi.edu:3478",
      "stun.wifirst.net:3478",
      "stun.wwdl.net:3478",
      "stun.xs4all.nl:3478",
      "stun.xtratelecom.es:3478",
      "stun.yesss.at:3478",
      "stun.zadarma.com:3478",
      "stun.zadv.com:3478",
      "stun.zoiper.com:3478",
      "stun1.faktortel.com.au:3478",
      "stunserver.org:3478",
      "stun.sipnet.net:3478",
      "stun.sipnet.ru:3478",
      "stun.stunprotocol.org:3478",
      "124.64.206.224:8800",
      "stun.nextcloud.com:443",
      "relay.webwormhole.io",
      "stun.flashdance.cx:3478",
      
    ],
  },
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
      connection.oniceconnectionstatechange = () => {
        console.log(
          `[${peerId}] ICE connection:`,
          connection.iceConnectionState,
        );
      };
      
      connection.onicegatheringstatechange = () => {
        console.log(
          `[${peerId}] ICE gathering:`,
          connection.iceGatheringState,
        );
      };
      
      connection.onicecandidateerror = (event) => {
        console.error(`[${peerId}] ICE candidate error`, {
          url: event.url,
          address: event.address,
          port: event.port,
          errorCode: event.errorCode,
          errorText: event.errorText,
        });
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

        if (connection.connectionState === "closed") {
          closePeer(peerId);
        }
        
        if (connection.connectionState === "failed") {
          console.error(
            `[${peerId}] Peer connection failed`,
          );
        }
      };

      return connection;
    };

    async function addOrQueueCandidate(
      peerId: string,
      connection: RTCPeerConnection,
      candidate: RTCIceCandidateInit,
    ) {
      if (connection.remoteDescription) {
        try {
          await connection.addIceCandidate(candidate);
        } catch (error) {
          console.error("addIceCandidate failed", peerId, error);
        }
    
        return;
      }
    
      const pending =
        pendingCandidatesRef.current.get(peerId) ?? [];
    
      pending.push(candidate);
      pendingCandidatesRef.current.set(peerId, pending);
    }
    
    async function flushCandidates(
      peerId: string,
      connection: RTCPeerConnection,
    ) {
      const pending =
        pendingCandidatesRef.current.get(peerId) ?? [];
    
      for (const candidate of pending) {
        try {
          await connection.addIceCandidate(candidate);
        } catch (error) {
          console.error(
            "queued addIceCandidate failed",
            peerId,
            error,
          );
        }
      }
    
      pendingCandidatesRef.current.delete(peerId);
    }

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
