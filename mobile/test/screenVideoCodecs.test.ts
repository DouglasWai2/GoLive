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
      codecs,
      overflow: false,
    });
  }
});

test("forces VP8 for the third and fourth screen viewers in Auto", () => {
  for (const count of [3, 4]) {
    assert.deepEqual(selectScreenVideoCodecs(codecs, count), {
      codecs: [codecs[1]],
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
  assert.equal(selectScreenVideoCodecs(codecsWithAv1, 1, "auto", ["H264", "AV1"]).codecs[0]?.mimeType,
    "video/AV1");
});

test("manual AV1 remains preferred for additional viewers without forcing VP8", () => {
  const codecsWithAv1 = [...codecs, { mimeType: "video/AV1" }];
  const choice = selectScreenVideoCodecs(codecsWithAv1, 4, "AV1", ["AV1"]);
  assert.equal(choice.codecs[0]?.mimeType, "video/AV1");
  assert.equal(choice.overflow, false);
});

test("manual H.264 falls back to VP8 after two viewers", () => {
  assert.deepEqual(selectScreenVideoCodecs(codecs, 4, "H264"), {
    codecs: [codecs[1]],
    overflow: true,
  });
});
