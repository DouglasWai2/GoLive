import { Dimensions, PixelRatio, Platform } from "react-native";
import {
  mediaDevices,
  MediaStream as RNMediaStream,
  RTCPeerConnection,
  RTCRtpSender,
} from "react-native-webrtc";
import { orderVideoCodecs } from "@golive/core";
import type {
  IceCandidateInit,
  MediaStream,
  PlatformAdapter,
  RTCPeerConnection as CorePeerConnection,
} from "@golive/core";
import { getScreenCaptureResolutionScale } from "./utils/screenCapture";

type NativeCandidate = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type UserMediaConstraints = {
  video: false;
  audio: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
};

/*
 * Android adapter: react-native-webrtc.
 *
 * getDisplayMedia() captures the full screen and optional device playback audio
 * via one MediaProjection session. Its Android resolutionScale option limits
 * source pixels to the requested output bounds before capture; frame rate stays
 * at the native capturer's fixed 30 fps and the sender applies the chosen cap.
 *
 * getUserMedia() is used for room voice microphone capture with echo cancellation,
 * noise suppression, and auto gain control.
 */
export const nativeAdapter: PlatformAdapter = {
  getDisplayMedia: async (constraints) => {
    const { width, height } = Dimensions.get("screen");
    const displayWidthPx = PixelRatio.getPixelSizeForLayoutSize(width);
    const displayHeightPx = PixelRatio.getPixelSizeForLayoutSize(height);
    const androidCaptureOptions = {
      createConfigForDefaultDisplay: true,
      ...(Platform.OS === "android"
        ? {
            resolutionScale: getScreenCaptureResolutionScale(
              displayWidthPx,
              displayHeightPx,
              constraints.video.width.max,
              constraints.video.height.max,
            ),
          }
        : {}),
    };
    const stream = mediaDevices.getDisplayMedia({
      audio: constraints.audio,
      android: androidCaptureOptions,
    }) as unknown as Promise<MediaStream>;

    const resolved = await stream;

    for (const track of resolved.getVideoTracks()) {
      track.enabled = true;
    }

    return resolved;
  },

  getUserMedia: async (constraints: UserMediaConstraints) => {
    const stream = await mediaDevices.getUserMedia({
      video: false,
      audio: constraints.audio as any,
    });
    return stream as unknown as MediaStream;
  },

  releaseMediaStream: (stream) => {
    (stream as unknown as RNMediaStream).release();
  },

  /*
   * Android rejects getDisplayMedia when the user declines the
   * MediaProjection consent dialog. Keep native setup and permission failures
   * visible instead of classifying every Error as a picker cancellation.
   */
  isCaptureRejected: (error) => {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { name?: unknown; message?: unknown };
    return candidate.name === "NotAllowedError"
      || candidate.message === "NotAllowedError";
  },

  serializeCandidate: (candidate) => {
    const c = candidate as NativeCandidate;

    return {
      candidate: c.candidate,
      sdpMid: c.sdpMid,
      sdpMLineIndex: c.sdpMLineIndex,
      usernameFragment: c.usernameFragment,
    } as IceCandidateInit;
  },

  createPeerConnection: ({ iceServers, purpose }) =>
    new RTCPeerConnection({
      iceServers: iceServers as never,
      golivePeerConnectionPurpose: purpose,
    } as any) as unknown as CorePeerConnection,

  configureVideoCodecs: (connection) => {
    const capabilities = RTCRtpSender.getCapabilities("video");

    if (!capabilities) {
      return;
    }

    const codecs = orderVideoCodecs(capabilities.codecs);
    const peerConnection = connection as unknown as RTCPeerConnection;

    for (const transceiver of peerConnection.getTransceivers()) {
      if (transceiver.sender.track?.kind === "video") {
        transceiver.setCodecPreferences(codecs);
      }
    }
  },
};
