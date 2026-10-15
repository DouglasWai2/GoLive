import type {
  HardwareAccelerationSupport,
  IceCandidateInit,
  PlatformAdapter,
  RTCPeerConnection as CorePeerConnection,
} from "@golive/core";
import { detectHardwareAcceleration, orderVideoCodecs } from "@golive/core";
import {
  captureProcessedMicrophone,
  releaseProcessedMicrophone,
} from "../audio/microphoneAudio";

/*
 * Browser adapter: navigator.mediaDevices + native WebRTC globals.
 */
let hwAccelCache: HardwareAccelerationSupport | null = null;

async function getHardwareAcceleration(): Promise<HardwareAccelerationSupport> {
  if (hwAccelCache) return hwAccelCache;
  hwAccelCache = await detectHardwareAcceleration();
  return hwAccelCache;
}

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

  getUserMedia: captureProcessedMicrophone,
  releaseMediaStream: releaseProcessedMicrophone,

  isCaptureRejected: (error) =>
    error instanceof DOMException && error.name === "NotAllowedError",

  serializeCandidate: (candidate) =>
    (candidate as RTCIceCandidate).toJSON() as IceCandidateInit,

  createPeerConnection: ({ iceServers }) =>
    new RTCPeerConnection({ iceServers }) as unknown as CorePeerConnection,

  configureVideoCodecs: async (connection) => {
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

    const hwAccel = await getHardwareAcceleration();
    const codecs = orderVideoCodecs(capabilities.codecs, hwAccel);
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
