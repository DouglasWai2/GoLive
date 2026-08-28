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

export type UserMediaConstraints = {
  video: false;
  audio: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
};

export type VideoCodecCapability = {
  mimeType: string;
};

const videoCodecPriority: Record<string, number> = {
  AV1: 0,
  AV1X: 0,
  VP8: 1,
  H264: 2,
};

export function orderVideoCodecs<T extends VideoCodecCapability>(
  codecs: readonly T[],
): T[] {
  return codecs
    .map((codec, index) => ({
      codec,
      index,
      priority:
        videoCodecPriority[codec.mimeType.split("/").pop()?.toUpperCase() ?? ""]
        ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) =>
      left.priority - right.priority || left.index - right.index,
    )
    .map(({ codec }) => codec);
}

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
 * - configureVideoCodecs: optional capability-based codec ordering before an
 *   offer is created.
 */
export type PlatformAdapter = {
  getDisplayMedia: (constraints: DisplayMediaConstraints) => Promise<MediaStream>;
  getUserMedia?: (constraints: UserMediaConstraints) => Promise<MediaStream>;
  removeUnsafeDisplayAudio?: (stream: MediaStream) => boolean;
  releaseMediaStream?: (stream: MediaStream) => void;
  isCaptureRejected: (error: unknown) => boolean;
  serializeCandidate: (candidate: unknown) => IceCandidateInit;
  createPeerConnection: (config: {
    iceServers: IceServer[];
    purpose: "screen" | "voice";
  }) => RTCPeerConnection;
  configureVideoCodecs?: (
    connection: RTCPeerConnection,
  ) => void | Promise<void>;
};
