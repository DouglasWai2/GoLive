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
  getDisplayMedia: (constraints) =>
    navigator.mediaDevices.getDisplayMedia({
      ...constraints,
      audio: constraints.audio ? { restrictOwnAudio: true } : false,
      systemAudio: "exclude",
      windowAudio: "exclude",
    } as DisplayMediaStreamOptions),

  getUserMedia: (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints),

  removeUnsafeDisplayAudio: (stream) => {
    const displaySurface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface;
    if (displaySurface === "browser") return false;

    const audioTracks = stream.getAudioTracks();
    for (const track of audioTracks) {
      track.stop();
      stream.removeTrack?.(track);
    }

    return audioTracks.length > 0;
  },

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
