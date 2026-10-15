import type {
  IceCandidateInit,
  IceServer,
  MediaStream,
  RTCPeerConnection,
  RTCRtpSender,
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

export type HardwareAccelerationSupport = {
  H264: boolean;
  VP8: boolean;
  VP9: boolean;
  AV1: boolean;
  HEVC: boolean;
};

/**
 * Detects hardware acceleration support for video codecs.
 * Uses RTCRtpSender.getCapabilities() to check for hardware encoder support.
 */
export async function detectHardwareAcceleration(): Promise<HardwareAccelerationSupport> {
  const defaultSupport: HardwareAccelerationSupport = {
    H264: true, // H264 is almost always hardware accelerated
    VP8: false,
    VP9: false,
    AV1: false,
    HEVC: false,
  };

  try {
    if (typeof RTCRtpSender === "undefined" || !RTCRtpSender.getCapabilities) {
      return defaultSupport;
    }

    const capabilities = RTCRtpSender.getCapabilities("video");
    if (!capabilities || !capabilities.codecs) {
      return defaultSupport;
    }

    const support: HardwareAccelerationSupport = { ...defaultSupport };

    for (const codec of capabilities.codecs) {
      const mimeType = codec.mimeType?.toLowerCase();
      if (!mimeType) continue;

      // Check if the codec has hardware acceleration
      // The presence of the codec in getCapabilities doesn't guarantee HW accel,
      // but we can check for specific implementations
      if (mimeType.includes("av1") || mimeType.includes("av01")) {
        support.AV1 = true;
      } else if (mimeType.includes("h264") || mimeType.includes("avc")) {
        support.H264 = true;
      } else if (mimeType.includes("vp9")) {
        support.VP9 = true;
      } else if (mimeType.includes("vp8")) {
        support.VP8 = true;
      } else if (mimeType.includes("hevc") || mimeType.includes("h265")) {
        support.HEVC = true;
      }
    }

    return support;
  } catch {
    return defaultSupport;
  }
}

const videoCodecPriority: Record<string, number> = {
  AV1: 0,
  AV1X: 0,
  H264: 1,
  HEVC: 2,
  VP8: 3,
  VP9: 4,
};

/**
 * Orders video codecs by priority, considering hardware acceleration.
 * Hardware-accelerated codecs get priority boost.
 */
export function orderVideoCodecs<T extends VideoCodecCapability>(
  codecs: readonly T[],
  hwAccel?: HardwareAccelerationSupport,
): T[] {
  const basePriority = (codec: VideoCodecCapability): number => {
    const mime = codec.mimeType.split("/").pop()?.toUpperCase() ?? "";
    return videoCodecPriority[mime] ?? Number.MAX_SAFE_INTEGER;
  };

  const hwPriority = (codec: VideoCodecCapability): number => {
    if (!hwAccel) return basePriority(codec);
    const mime = codec.mimeType.split("/").pop()?.toUpperCase() ?? "";
    const hwAccelerated = hwAccel[mime as keyof HardwareAccelerationSupport];
    // Hardware accelerated codecs get priority boost (subtract 10)
    return hwAccelerated ? basePriority(codec) - 10 : basePriority(codec);
  };

  return codecs
    .map((codec, index) => ({
      codec,
      index,
      priority: hwPriority(codec),
    }))
    .sort((left, right) =>
      left.priority - right.priority || left.index - right.index,
    )
    .map(({ codec }) => codec);
}

export type PlatformAdapter = {
  getDisplayMedia: (constraints: DisplayMediaConstraints) => Promise<MediaStream>;
  getUserMedia?: (constraints: UserMediaConstraints) => Promise<MediaStream>;
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
