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

type VideoEncodingConfiguration = {
  type: "webrtc";
  video: {
    contentType: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
  };
};

type VideoEncodingInfo = {
  supported: boolean;
  powerEfficient: boolean;
};

type VideoEncodingInfoQuery = (
  configuration: VideoEncodingConfiguration,
) => Promise<VideoEncodingInfo>;

const hardwareCodecContentTypes: Record<keyof HardwareAccelerationSupport, string> = {
  H264: 'video/mp4; codecs="avc1.42E01E"',
  VP8: 'video/webm; codecs="vp8"',
  VP9: 'video/webm; codecs="vp9"',
  AV1: 'video/mp4; codecs="av01.0.10M.08"',
  HEVC: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
};

function getHardwareCodec(mimeType: string): keyof HardwareAccelerationSupport | null {
  const mime = mimeType.split("/").pop()?.toUpperCase() ?? "";

  switch (mime) {
    case "H264":
    case "AVC":
      return "H264";
    case "VP8":
      return "VP8";
    case "VP9":
      return "VP9";
    case "AV1":
    case "AV01":
    case "AV1X":
      return "AV1";
    case "HEVC":
    case "H265":
      return "HEVC";
    default:
      return null;
  }
}

function getBrowserVideoCodecs(): readonly VideoCodecCapability[] {
  try {
    if (typeof RTCRtpSender === "undefined" || !RTCRtpSender.getCapabilities) {
      return [];
    }

    return RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  } catch {
    return [];
  }
}

function getVideoEncodingInfoQuery(): VideoEncodingInfoQuery | undefined {
  if (
    typeof navigator === "undefined"
    || typeof navigator.mediaCapabilities?.encodingInfo !== "function"
  ) {
    return undefined;
  }

  return (configuration) => navigator.mediaCapabilities.encodingInfo(configuration);
}

/**
 * Uses MediaCapabilities' power-efficiency signal as a hardware-encoding
 * heuristic, and only for codecs also exposed by WebRTC. getCapabilities()
 * alone lists usable codecs; it does not indicate hardware acceleration.
 * Browsers may not expose this signal, in which case codec ordering falls back
 * to the conservative H.264-first priority.
 */
export async function detectHardwareAcceleration(
  codecs: readonly VideoCodecCapability[] = getBrowserVideoCodecs(),
  encodingInfo: VideoEncodingInfoQuery | null | undefined = getVideoEncodingInfoQuery(),
): Promise<HardwareAccelerationSupport> {
  const support: HardwareAccelerationSupport = {
    H264: false,
    VP8: false,
    VP9: false,
    AV1: false,
    HEVC: false,
  };

  if (!encodingInfo) return support;

  const availableCodecs = new Set<keyof HardwareAccelerationSupport>();
  for (const codec of codecs) {
    const key = codec.mimeType ? getHardwareCodec(codec.mimeType) : null;
    if (key) availableCodecs.add(key);
  }

  await Promise.all([...availableCodecs].map(async (key) => {
    try {
      const result = await encodingInfo({
        type: "webrtc",
        video: {
          contentType: hardwareCodecContentTypes[key],
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
          framerate: 60,
        },
      });

      support[key] = result.supported && result.powerEfficient;
    } catch {
      // A failed query is not evidence of hardware acceleration.
    }
  }));

  return support;
}

const videoCodecPriority: Record<string, number> = {
  H264: 0,
  VP8: 1,
  VP9: 2,
  AV1: 3,
  AV1X: 3,
  HEVC: 4,
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
    const key = getHardwareCodec(codec.mimeType);
    return key
      ? videoCodecPriority[key]
      : Number.MAX_SAFE_INTEGER;
  };

  const hwPriority = (codec: VideoCodecCapability): number => {
    const key = getHardwareCodec(codec.mimeType);

    // Keep H.264 as the safe default even when MediaCapabilities reports AV1
    // as power efficient; that signal is not a definitive hardware check.
    if (key === "H264") return -1;
    if (!hwAccel) return basePriority(codec);
    if (!key) return Number.MAX_SAFE_INTEGER;

    // Prefer efficient alternatives over software-only ones, but not over H.264.
    return (hwAccel[key] ? 1 : 10) + basePriority(codec);
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
