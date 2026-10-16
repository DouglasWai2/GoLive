import { preferVideoCodec } from "@golive/core";
import type { VideoCodecPreference } from "@golive/core";

/**
 * Android devices often allow only two simultaneous H.264 hardware encoders.
 * Each viewer needs its own P2P encoder, so overflow viewers use VP8 rather
 * than risk exhausting the H.264 hardware encoder instances.
 * Do not offer H.264 or other codecs on those connections: an answer could
 * otherwise select H.264 again, even if VP8 is listed first.
 */
export function selectScreenVideoCodecs<T extends { mimeType: string }>(
  codecs: readonly T[],
  screenPublisherConnectionCount: number,
  preference: VideoCodecPreference = "auto",
  hardwareCodecs: readonly VideoCodecPreference[] = [],
): { codecs: T[]; overflow: boolean } {
  if (screenPublisherConnectionCount <= 2 || (preference !== "auto" && preference !== "H264")) {
    const preferred = preference === "auto" && hardwareCodecs.includes("AV1") ? "AV1" : preference;
    return { codecs: preferVideoCodec(codecs, preferred), overflow: false };
  }

  // Even a manual H.264 preference must not exceed the common two-encoder
  // Android limit. VP8 is used as a compatibility fallback for extra viewers.
  const vp8 = codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/vp8");
  return vp8.length > 0
    ? { codecs: vp8, overflow: true }
    : { codecs: [...codecs], overflow: false };
}
