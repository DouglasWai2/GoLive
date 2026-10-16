import assert from "node:assert/strict";
import test from "node:test";
import {
  detectHardwareAcceleration,
  orderVideoCodecs,
  type VideoCodecCapability,
} from "../src/adapter";

const codecs: VideoCodecCapability[] = [
  { mimeType: "video/AV1" },
  { mimeType: "video/VP9" },
  { mimeType: "video/H264" },
  { mimeType: "video/rtx" },
];

test("prefers H.264 over AV1 when hardware efficiency is unknown", () => {
  assert.deepEqual(
    orderVideoCodecs(codecs).map(({ mimeType }) => mimeType),
    ["video/H264", "video/VP9", "video/AV1", "video/rtx"],
  );
});

test("WebRTC codec availability alone does not count as hardware acceleration", async () => {
  const support = await detectHardwareAcceleration(codecs, async ({ video }) => ({
    supported: true,
    powerEfficient: video.contentType.includes("avc1"),
  }));

  assert.deepEqual(support, {
    H264: true,
    VP8: false,
    VP9: false,
    AV1: false,
    HEVC: false,
  });
  assert.deepEqual(
    orderVideoCodecs(codecs, support).map(({ mimeType }) => mimeType),
    ["video/H264", "video/VP9", "video/AV1", "video/rtx"],
  );
});

test("prefers efficient alternatives but keeps H.264 ahead of AV1", async () => {
  const support = await detectHardwareAcceleration(codecs, async ({ video }) => ({
    supported: true,
    powerEfficient: video.contentType.includes("av01"),
  }));

  assert.equal(support.AV1, true);
  assert.deepEqual(
    orderVideoCodecs(codecs, support).map(({ mimeType }) => mimeType),
    ["video/H264", "video/AV1", "video/VP9", "video/rtx"],
  );
});

test("uses the conservative ordering when MediaCapabilities is unavailable", async () => {
  const support = await detectHardwareAcceleration(codecs, null);

  assert.deepEqual(Object.values(support), [false, false, false, false, false]);
  assert.equal(orderVideoCodecs(codecs, support)[0]?.mimeType, "video/H264");
});
