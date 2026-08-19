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
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
};

export type ServerMessage =
  | { type: "room-state"; selfId: string; peers: Peer[] }
  | { type: "peer-joined"; peer: Peer }
  | { type: "peer-left"; peerId: string }
  | { type: "peer-updated"; peer: Peer }
  | { type: "sharing-accepted"; sharing: boolean }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "error"; code?: string; message: string };

export type SignalData =
  | RTCSessionDescriptionInit
  | { candidate: RTCIceCandidateInit };

export type SocketStatus = "connecting" | "connected" | "disconnected";
