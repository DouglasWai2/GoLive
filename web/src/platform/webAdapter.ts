import type {
  IceCandidateInit,
  PlatformAdapter,
  RTCPeerConnection as CorePeerConnection,
} from "@golive/core";
import { orderVideoCodecs } from "@golive/core";

/*
 * Browser adapter: navigator.mediaDevices + native WebRTC globals.
 */
export const webAdapter: PlatformAdapter = {
  getDisplayMedia: async (constraints) => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      ...constraints,
      audio: constraints.audio ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      } : false,
    });

    // Shared playback is music/media, not microphone speech. Browsers may ignore
    // capture constraints, but this hint also informs the WebRTC audio encoder.
    for (const track of stream.getAudioTracks()) {
      track.contentHint = "music";
    }

    return stream;
  },

  getUserMedia: (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints),

  isCaptureRejected: (error) =>
    error instanceof DOMException && error.name === "NotAllowedError",

  serializeCandidate: (candidate) =>
    (candidate as RTCIceCandidate).toJSON() as IceCandidateInit,

  createPeerConnection: ({ iceServers }) =>
    new RTCPeerConnection({ iceServers }) as unknown as CorePeerConnection,

  configureVideoCodecs: (connection) => {
    if (
      typeof RTCRtpSender === "undefined"
      || typeof RTCRtpSender.getCapabilities !== "function"
      || typeof RTCPeerConnection.prototype.getTransceivers !== "function"
    ) {
      return;
    }

    const capabilities = RTCRtpSender.getCapabilities("video");

    if (!capabilities) {
      return;
    }

    const codecs = orderVideoCodecs(capabilities.codecs);
    const peerConnection = connection as unknown as RTCPeerConnection;

    for (const transceiver of peerConnection.getTransceivers()) {
      if (
        transceiver.sender.track?.kind === "video"
        && typeof transceiver.setCodecPreferences === "function"
      ) {
        transceiver.setCodecPreferences(codecs);
      }
    }
  },
};
