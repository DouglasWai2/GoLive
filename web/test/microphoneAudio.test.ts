import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutomaticNoiseGateThresholdDb,
  getNoiseGateClosedGain,
  getMicrophoneSensitivityFromThresholdDb,
  getNoiseGateThresholdDb,
  getMicrophoneMeterPosition,
} from "../src/audio/microphoneAudio";

test("higher microphone sensitivity opens the noise gate for quieter speech", () => {
  assert.ok(getNoiseGateThresholdDb(100) < getNoiseGateThresholdDb(0));
});

test("input threshold maps back to the matching manual sensitivity", () => {
  for (const sensitivity of [0, 25, 50, 75, 100]) {
    assert.equal(
      getMicrophoneSensitivityFromThresholdDb(getNoiseGateThresholdDb(sensitivity)),
      sensitivity,
    );
  }
  assert.equal(getMicrophoneSensitivityFromThresholdDb(-90), 100);
  assert.equal(getMicrophoneSensitivityFromThresholdDb(0), 0);
});

test("automatic sensitivity keeps its threshold within a safe range", () => {
  assert.equal(getAutomaticNoiseGateThresholdDb(-90), -61);
  assert.equal(getAutomaticNoiseGateThresholdDb(-50), -42);
  assert.equal(getAutomaticNoiseGateThresholdDb(-10), -40);
});

test("noise gate strength controls attenuation below the threshold", () => {
  assert.equal(getNoiseGateClosedGain(0), 1);
  assert.ok(getNoiseGateClosedGain(100) < getNoiseGateClosedGain(50));
  assert.ok(getNoiseGateClosedGain(100) > 0);
});

test("microphone meter clamps measured dB to its display range", () => {
  assert.equal(getMicrophoneMeterPosition(-70), 0);
  assert.equal(getMicrophoneMeterPosition(-20), 100);
  assert.equal(getMicrophoneMeterPosition(-45), 50);
  assert.equal(getMicrophoneMeterPosition(-90), 0);
  assert.equal(getMicrophoneMeterPosition(0), 100);
});
