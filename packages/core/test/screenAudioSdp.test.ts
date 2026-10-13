import assert from "node:assert/strict";
import test from "node:test";
import { preferStereoScreenAudio } from "../src/webrtc";

const offerSdp = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 VP8/90000",
  "",
].join("\r\n");

test("offers stereo capability for Opus on screen connections without changing video", () => {
  const tuned = preferStereoScreenAudio({ type: "offer", sdp: offerSdp });
  assert.equal(tuned.sdp, offerSdp.replace(
    "minptime=10;useinbandfec=1",
    "minptime=10;useinbandfec=1;sprop-stereo=1",
  ));
});

test("answers request high-quality stereo even when Opus lacks an fmtp line", () => {
  const sdp = offerSdp.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", "");
  const tuned = preferStereoScreenAudio({ type: "answer", sdp });
  assert.match(tuned.sdp!, /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 stereo=1;maxaveragebitrate=128000\r\n/);
  assert.equal(tuned.sdp?.split("m=video")[1], sdp.split("m=video")[1]);
});

test("replaces an existing mono Opus preference without duplicating parameters", () => {
  const sdp = offerSdp.replace(
    "minptime=10;useinbandfec=1",
    "minptime=10;stereo=0;maxaveragebitrate=32000;useinbandfec=1",
  );
  const tuned = preferStereoScreenAudio({ type: "answer", sdp });
  assert.match(tuned.sdp!, /a=fmtp:111 minptime=10;stereo=1;maxaveragebitrate=128000;useinbandfec=1\r\n/);
  assert.equal((tuned.sdp!.match(/stereo=1/g) ?? []).length, 1);
});

test("does not change connections without a negotiated Opus payload", () => {
  const description = { type: "answer" as const, sdp: offerSdp.replace("111 0", "0") };
  assert.equal(preferStereoScreenAudio(description), description);
  const videoOnly = { type: "offer" as const, sdp: offerSdp.split("m=audio")[0]! };
  assert.equal(preferStereoScreenAudio(videoOnly), videoOnly);
});
