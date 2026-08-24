import { mediaDevices, MediaStream as RNMediaStream, RTCPeerConnection } from "react-native-webrtc";
import type {
  IceCandidateInit,
  MediaStream,
  PlatformAdapter,
  RTCPeerConnection as CorePeerConnection,
} from "@golive/core";

type NativeCandidate = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

/*
 * Android adapter: react-native-webrtc.
 *
 * getDisplayMedia() captures the full screen and optional device playback audio
 * via one MediaProjection session.
 * Android capture ignores resolution/fps constraints (the whole display is
 * captured), so the web constraint caps only apply to the remote senders.
 */
export const nativeAdapter: PlatformAdapter = {
  getDisplayMedia: async (constraints) => {
    const stream = mediaDevices.getDisplayMedia({
      audio: constraints.audio,
      android: { createConfigForDefaultDisplay: true },
    }) as unknown as Promise<MediaStream>;

    const resolved = await stream;

    for (const track of resolved.getVideoTracks()) {
      track.enabled = true;
    }

    return resolved;
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

  createPeerConnection: ({ iceServers }) =>
    new RTCPeerConnection({
      iceServers: iceServers as never,
    }) as unknown as CorePeerConnection,

  /*
   * Android's offer lists hardware H.264 first; hardware H.264 encoding of
   * MediaProjection frames is a known source of black video on web receivers
   * (the connection is healthy, but no visible frames arrive). Strip every
   * non-VP8 video codec from m=video so the negotiated codec is VP8.
   *
   * The rewrite is section-scoped and validated: if anything looks off it
   * returns the original SDP untouched so the offer always stays parseable.
   */
  mungeOffer: (sdp) => {
    const removedCodecs = new Set(["VP9", "AV1", "AV1X"]);
    const lines = sdp.split("\r\n");

    const videoIndex = lines.findIndex((line) => /^m=video/.test(line));

    if (videoIndex === -1) {
      return sdp;
    }

    let sectionEnd = lines.length;

    for (let i = videoIndex + 1; i < lines.length; i += 1) {
      if (/^m=/.test(lines[i])) {
        sectionEnd = i;
        break;
      }
    }

    const videoHeader = /^(m=video\s+\d+\s+\S+\s+)(.*)$/.exec(lines[videoIndex]);

    if (!videoHeader) {
      return sdp;
    }

    const videoPayloads = videoHeader[2].trim().split(/\s+/).filter(Boolean);

    if (videoPayloads.length === 0) {
      return sdp;
    }

    const codecByPayload = new Map<string, string>();
    const baseByPayload = new Map<string, string>();

    for (let i = videoIndex + 1; i < sectionEnd; i += 1) {
      const rtp = /^a=rtpmap:(\d+)\s+([^/\s]+)\//.exec(lines[i]);

      if (rtp) {
        codecByPayload.set(rtp[1], rtp[2].toUpperCase());
      }

      const fmtp = /^a=fmtp:(\d+)\s+.*\bapt=(\d+)/.exec(lines[i]);

      if (fmtp) {
        baseByPayload.set(fmtp[1], fmtp[2]);
      }
    }

    const removed = new Set<string>();

    for (const [payload, codec] of codecByPayload) {
      if (removedCodecs.has(codec)) {
        removed.add(payload);
      }
    }

    for (const [payload, base] of baseByPayload) {
      if (removed.has(base)) {
        removed.add(payload);
      }
    }

    const keptPayloads = videoPayloads.filter((payload) => !removed.has(payload));

    if (keptPayloads.length === 0) {
      console.warn(
        "[mungeOffer] No video codecs left after filtering; using original offer",
      );
      return sdp;
    }

    if (!keptPayloads.every((payload) => codecByPayload.has(payload))) {
      console.warn(
        "[mungeOffer] Kept payloads missing rtpmap; using original offer",
      );
      return sdp;
    }

    console.log(
      `[mungeOffer] video payloads ${videoPayloads.length} -> ${keptPayloads.length} (${keptPayloads.join(",")})`,
    );

    const rebuilt: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (i === videoIndex) {
        rebuilt.push(videoHeader[1] + keptPayloads.join(" "));
        continue;
      }

      if (i > videoIndex && i < sectionEnd) {
        const payloadAttr = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/.exec(line);

        if (payloadAttr && removed.has(payloadAttr[1])) {
          continue;
        }
      }

      rebuilt.push(line);
    }

    return rebuilt.join("\r\n");
  },
};
