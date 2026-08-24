import type {
  IceCandidateInit,
  IceServer,
  MediaStream,
  RTCPeerConnection,
} from "./types";

export type DisplayMediaConstraints = {
  video: {
    width: { ideal: number; max: number };
    height: { ideal: number; max: number };
    frameRate: { ideal: number; max: number };
  };
  audio?: boolean;
};

/*
 * Platform-specific pieces of the room session.
 *
 * - getDisplayMedia: browser navigator.mediaDevices.getDisplayMedia, or
 *   react-native-webrtc mediaDevices.getDisplayMedia (Android screen capture).
 * - releaseMediaStream: optional native stream cleanup after its tracks stop.
 * - isCaptureRejected: true when the user declined the capture picker.
 * - serializeCandidate: normalizes a platform ICE candidate into the JSON
 *   shape sent over the signaling WebSocket.
 * - createPeerConnection: factory so the core never touches platform globals
 *   directly.
 */
export type PlatformAdapter = {
  getDisplayMedia: (constraints: DisplayMediaConstraints) => Promise<MediaStream>;
  releaseMediaStream?: (stream: MediaStream) => void;
  isCaptureRejected: (error: unknown) => boolean;
  serializeCandidate: (candidate: unknown) => IceCandidateInit;
  createPeerConnection: (config: {
    iceServers: IceServer[];
  }) => RTCPeerConnection;
  /*
   * Optional SDP rewrite applied to the sharer's offer before it is set
   * locally. Android uses this to drop hardware H.264 from m=video so the
   * negotiated codec is VP8 (hardware H.264 MediaProjection capture is a
   * known source of black frames on web receivers).
   */
  mungeOffer?: (sdp: string) => string;
};
