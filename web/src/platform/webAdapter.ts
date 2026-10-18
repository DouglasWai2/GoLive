import type {
  HardwareAccelerationSupport,
  IceCandidateInit,
  PlatformAdapter,
  RTCPeerConnection as CorePeerConnection,
  VideoCodecPreference,
} from "@golive/core";
import { availableVideoCodecs, detectHardwareAcceleration, orderVideoCodecs, preferVideoCodec } from "@golive/core";
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

export function getBrowserScreenVideoCodecs(): VideoCodecPreference[] {
  try {
    return availableVideoCodecs(RTCRtpSender.getCapabilities("video")?.codecs ?? []);
  } catch {
    return [];
  }
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

  configureVideoCodecs: async (connection, { preferredCodec }) => {
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

    const hwAccel = preferredCodec === "auto" ? await getHardwareAcceleration() : undefined;
    const codecs = preferVideoCodec(orderVideoCodecs(capabilities.codecs, hwAccel), preferredCodec);
    const peerConnection = connection as unknown as RTCPeerConnection;

    // iOS Safari: VideoToolbox hardware decoder struggles with H.264 High Profile
    // negotiated by desktop senders. Prefer VP8/VP9 on receiver side to avoid
    // software decoding fallback which causes severe stuttering.
    const isIOSSafari =
      /iPhone|iPad|iPod/.test(navigator.userAgent) &&
      /Safari/.test(navigator.userAgent) &&
      !/Chrome|CriOS/.test(navigator.userAgent);

    const receiverCodecs = isIOSSafari
      ? codecs.filter((c) => !c.mimeType.toLowerCase().includes("h264"))
      : codecs;

    for (const transceiver of peerConnection.getTransceivers()) {
      // Sender side (local track): use negotiated preference
      if (
        transceiver.sender.track?.kind === "video"
        && typeof transceiver.setCodecPreferences === "function"
      ) {
        transceiver.setCodecPreferences(codecs);
      }
      // Receiver side (remote track): on iOS Safari, avoid H.264
      if (
        transceiver.receiver.track?.kind === "video"
        && typeof transceiver.setCodecPreferences === "function"
      ) {
        transceiver.setCodecPreferences(receiverCodecs);
      }
    }
  },
};
