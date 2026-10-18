import assert from "node:assert/strict";
import test from "node:test";
import { selectScreenVideoCodecs } from "../src/utils/screenVideoCodecs";

const codecs = [
  { mimeType: "video/H264" },
  { mimeType: "video/VP8" },
  { mimeType: "video/rtx" },
  { mimeType: "video/VP9" },
];

test("keeps H.264 preferred for the first two Android screen viewers", () => {
  for (const count of [1, 2]) {
    assert.deepEqual(selectScreenVideoCodecs(codecs, count), {
      codecs: [codecs[0], codecs[1], codecs[3], codecs[2]],
      overflow: false,
    });
  }
});

test("uses VP8 for the third and fourth viewers when Auto selects H.264", () => {
  for (const count of [3, 4]) {
    assert.deepEqual(selectScreenVideoCodecs(codecs, count), {
      codecs: [codecs[1], codecs[2]],
      overflow: true,
    });
  }
});

test("does not disable video when VP8 is unavailable", () => {
  assert.deepEqual(selectScreenVideoCodecs([codecs[0]!], 4), {
    codecs: [codecs[0]],
    overflow: false,
  });
});

test("prefers hardware AV1 when Auto can use it, even if H.264 was listed first", () => {
  const codecsWithAv1 = [...codecs, { mimeType: "video/AV1" }];
  assert.equal(selectScreenVideoCodecs(codecsWithAv1, 4, "auto", ["H264", "AV1"]).codecs[0]?.mimeType,
    "video/AV1");
});

test("manual AV1 is forced for additional viewers instead of being replaced by Auto", () => {
  const codecsWithAv1 = [...codecs, { mimeType: "video/AV1" }];
  const choice = selectScreenVideoCodecs(codecsWithAv1, 4, "AV1", ["AV1"]);
  assert.deepEqual(choice.codecs, [{ mimeType: "video/AV1" }, codecs[2]]);
  assert.equal(choice.overflow, false);
});

test("manual H.264 remains selected after two viewers", () => {
  assert.deepEqual(selectScreenVideoCodecs(codecs, 4, "H264"), {
    codecs: [codecs[0], codecs[2]],
    overflow: false,
  });
});

test("Auto prefers any detected hardware codec, not just AV1", () => {
  assert.equal(selectScreenVideoCodecs(codecs, 1, "auto", ["VP8"]).codecs[0]?.mimeType,
    "video/VP8");
});

test("manual selection excludes other video codecs but retains matching repair codecs", () => {
  const capabilities = [
    { mimeType: "video/H264", payloadType: 102 },
    { mimeType: "video/rtx", payloadType: 121, sdpFmtpLine: "apt=102" },
    { mimeType: "video/VP8", payloadType: 96 },
    { mimeType: "video/rtx", payloadType: 97, sdpFmtpLine: "apt=96" },
    { mimeType: "video/ulpfec", payloadType: 116 },
  ];
  const choice = selectScreenVideoCodecs(capabilities, 1, "VP8");
  assert.deepEqual(choice.codecs.map((codec) => codec.mimeType), [
    "video/VP8", "video/rtx", "video/ulpfec",
  ]);
  assert.deepEqual(choice.codecs.map((codec) => codec.payloadType), [96, 97, 116]);
});
