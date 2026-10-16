import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VOICE_PLAYBACK_SETTINGS,
  getVoicePlaybackVolume,
} from "../src/utils/voicePlayback";

test("uses full voice volume by default", () => {
  assert.equal(getVoicePlaybackVolume(DEFAULT_VOICE_PLAYBACK_SETTINGS, 1, false), 1);
});

test("multiplies participant and room voice volume", () => {
  assert.equal(
    getVoicePlaybackVolume({ volume: 0.6, muted: false }, 0.5, false),
    0.3,
  );
});

test("participant mute and room deafen override volume", () => {
  assert.equal(getVoicePlaybackVolume({ volume: 0.8, muted: true }, 0.7, false), 0);
  assert.equal(getVoicePlaybackVolume({ volume: 0.8, muted: false }, 0.7, true), 0);
});

test("zero room voice volume silences every participant", () => {
  assert.equal(getVoicePlaybackVolume({ volume: 1, muted: false }, 0, false), 0);
});
