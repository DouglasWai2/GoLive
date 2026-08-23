/*
 * Platform-neutral protocol and media types.
 *
 * The web app's DOM types (MediaStream, RTCPeerConnection, ...) and
 * react-native-webrtc's equivalents are structurally compatible with the
 * minimal interfaces defined here, so the core never depends on a browser
 * lib.dom at runtime or compile time.
 */

export type Peer = {
  id: string;
  name: string;
  sharing: boolean;
};

export type ShareSettings = {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
};

export type RemoteVideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number;
  codec: string | null;
  route: string | null;
  rttMs: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
};

export type OutboundVideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number;
  codec: string | null;
  route: string | null;
  rttMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  qualityLimitationReason: string | null;
};

export type SocketStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type PeerConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export type IceCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type SessionDescriptionInit = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
};

export type SignalData =
  | SessionDescriptionInit
  | { candidate: IceCandidateInit }
  | { restartRequest: true };

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type ServerMessage =
  | { type: "authenticated" }
  | { type: "room-state"; selfId: string; peers: Peer[] }
  | { type: "peer-joined"; peer: Peer }
  | { type: "peer-left"; peerId: string }
  | { type: "peer-updated"; peer: Peer }
  | { type: "sharing-accepted"; sharing: boolean }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "error"; code?: string; message: string };

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "join"; room: string; name: string }
  | { type: "signal"; target: string; data: unknown }
  | { type: "sharing"; sharing: boolean };

/*
 * Media stream surface used by the room session.
 */
export type MediaTrack = {
  readonly id: string;
  readonly kind: string;
  enabled: boolean;
  readonly readyState?: "live" | "ended";
  stop(): void;
  addEventListener(
    type: "ended",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  getSettings?: () => {
    width?: number;
    height?: number;
    frameRate?: number;
  };
  applyConstraints?: (
    constraints: {
      width?: { ideal?: number; max?: number };
      height?: { ideal?: number; max?: number };
      frameRate?: { ideal?: number; max?: number };
    },
  ) => Promise<void>;
};

export type MediaStream = {
  readonly id: string;
  getTracks(): MediaTrack[];
  getVideoTracks(): MediaTrack[];
  getAudioTracks(): MediaTrack[];
};

export type RTCRtpEncodingParameters = {
  maxBitrate?: number;
  maxFramerate?: number;
  scaleResolutionDownBy?: number;
  [key: string]: unknown;
};

export type RTCRtpSendParameters = {
  encodings?: RTCRtpEncodingParameters[];
  degradationPreference?:
    | "maintain-framerate"
    | "maintain-resolution"
    | "balanced";
  [key: string]: unknown;
};

export type RTCRtpSender = {
  track: MediaTrack | null;
  getParameters(): RTCRtpSendParameters;
  setParameters(params: RTCRtpSendParameters): Promise<void>;
};

/*
 * The shape of the RTCStatsReport members the core reads. Both the browser
 * RTCStatsReport and react-native-webrtc's report expose forEach()/get().
 */
export type StatsReportLike = {
  forEach(callback: (report: Record<string, unknown>) => void): void;
  get(id: string): Record<string, unknown> | undefined;
};

/*
 * Minimal RTCPeerConnection surface used by the room session.
 */
export type RTCPeerConnection = {
  readonly signalingState: string;
  readonly connectionState: PeerConnectionState;
  readonly iceConnectionState: string;
  readonly iceGatheringState: string;
  localDescription: SessionDescriptionInit | null;
  remoteDescription: SessionDescriptionInit | null;

  onicecandidate: ((event: { candidate: unknown }) => void) | null;
  onicecandidateerror: ((event: unknown) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onsignalingstatechange: (() => void) | null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;

  addTrack(track: MediaTrack, stream: MediaStream): unknown;
  addIceCandidate(candidate: IceCandidateInit): Promise<void>;
  createOffer(options?: { iceRestart?: boolean }): Promise<SessionDescriptionInit>;
  createAnswer(): Promise<SessionDescriptionInit>;
  setLocalDescription(description: SessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: SessionDescriptionInit): Promise<void>;
  getSenders(): RTCRtpSender[];
  getStats(): Promise<StatsReportLike>;
  close(): void;
};

/*
 * The WebSocket surface used by the room session.
 */
export type SocketEvent = { data: unknown };
export type CloseEvent = { code: number };

export type WebSocketLike = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: SocketEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};
