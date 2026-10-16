import assert from "node:assert/strict";
import test from "node:test";
import { getScreenViewerBitrate } from "../src/webrtc";

test("splits a screen share bitrate budget across active viewers", () => {
  assert.equal(getScreenViewerBitrate(8_000_000, 1), 8_000_000);
  assert.equal(getScreenViewerBitrate(8_000_000, 2), 4_000_000);
  assert.equal(getScreenViewerBitrate(8_000_000, 3), 2_666_666);
  assert.equal(getScreenViewerBitrate(8_000_000, 0), 8_000_000);
});
