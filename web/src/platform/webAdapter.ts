import type {
  IceCandidateInit,
  PlatformAdapter,
  RTCPeerConnection,
} from "@golive/core";

/*
 * Browser adapter: navigator.mediaDevices + native WebRTC globals.
 */
export const webAdapter: PlatformAdapter = {
  getDisplayMedia: (constraints) =>
    navigator.mediaDevices.getDisplayMedia(constraints),

  isCaptureRejected: (error) =>
    error instanceof DOMException && error.name === "NotAllowedError",

  serializeCandidate: (candidate) =>
    (candidate as RTCIceCandidate).toJSON() as IceCandidateInit,

  createPeerConnection: ({ iceServers }) =>
    new RTCPeerConnection({ iceServers }) as unknown as RTCPeerConnection,
};