import { orderVideoCodecs } from "@golive/core";
import type { HardwareAccelerationSupport } from "@golive/core";
import type { VideoCodecPreference } from "@golive/core";

type ScreenVideoCodec = {
  mimeType: string;
  payloadType?: number;
  sdpFmtpLine?: string;
};

function codecPreference(mimeType: string): Exclude<VideoCodecPreference, "auto"> | null {
  const name = mimeType.split("/").pop()?.toUpperCase();
  if (name === "H264" || name === "VP8" || name === "VP9" || name === "AV1" || name === "AV1X") {
    return name === "AV1X" ? "AV1" : name;
  }
  return null;
}

function orderForDetectedHardware<T extends ScreenVideoCodec>(
  codecs: readonly T[],
  hardwareCodecs: readonly VideoCodecPreference[],
): T[] {
  const hardware: HardwareAccelerationSupport = {
    H264: hardwareCodecs.includes("H264"),
    VP8: hardwareCodecs.includes("VP8"),
    VP9: hardwareCodecs.includes("VP9"),
    AV1: hardwareCodecs.includes("AV1"),
    HEVC: false,
  };
  return orderVideoCodecs(codecs, hardware);
}

function includeCodecAndRepair<T extends ScreenVideoCodec>(
  codecs: readonly T[],
  selected: readonly T[],
): T[] {
  const payloadTypes = new Set(
    selected.flatMap((codec) => typeof codec.payloadType === "number" ? [codec.payloadType] : []),
  );
  const repair = codecs.filter((codec) => {
    const name = codec.mimeType.split("/").pop()?.toLowerCase();
    if (name === "rtx") {
      const apt = codec.sdpFmtpLine?.match(/(?:^|;)\s*apt=(\d+)/i)?.[1];
      return apt ? payloadTypes.has(Number(apt)) : payloadTypes.size === 0;
    }
    return name === "red" || name === "ulpfec" || name === "flexfec-03";
  });

  return [...selected, ...repair];
}

/**
 * Auto avoids the common Android H.264 encoder-instance limit by switching
 * additional viewers to VP8. Explicit codec choices are never overridden.
 */
export function selectScreenVideoCodecs<T extends ScreenVideoCodec>(
  codecs: readonly T[],
  screenPublisherConnectionCount: number,
  preference: VideoCodecPreference = "auto",
  hardwareCodecs: readonly VideoCodecPreference[] = [],
): { codecs: T[]; overflow: boolean } {
  const orderedCodecs = orderForDetectedHardware(codecs, hardwareCodecs);

  if (preference !== "auto") {
    const selected = orderedCodecs.filter((codec) => codecPreference(codec.mimeType) === preference);
    return {
      codecs: selected.length > 0
        ? includeCodecAndRepair(orderedCodecs, selected)
        : orderedCodecs,
      overflow: false,
    };
  }

  const automaticCodec = orderedCodecs.find((codec) => codecPreference(codec.mimeType));
  if (
    screenPublisherConnectionCount > 2
    && automaticCodec
    && codecPreference(automaticCodec.mimeType) === "H264"
  ) {
    // Preserve the Android H.264 instance limit in Auto, but never override a
    // codec explicitly selected by the user.
    const vp8 = orderedCodecs.filter((codec) => codecPreference(codec.mimeType) === "VP8");
    if (vp8.length > 0) {
      return {
        codecs: includeCodecAndRepair(orderedCodecs, vp8),
        overflow: true,
      };
    }
  }

  return { codecs: orderedCodecs, overflow: false };
}
