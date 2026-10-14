import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { updatePlaybackState } from "../src/hooks/useVideoPlaybackState";

test("reuses playback state for duplicate phases", () => {
  const stream = {} as MediaStream;
  let state = updatePlaybackState(
    { stream: null, active: false, phase: "playing" },
    stream,
    true,
    "playing",
  );
  const playingState = state;

  state = updatePlaybackState(state, stream, true, "playing");

  assert.equal(state, playingState);
});

test("changes playback state when its stream, activity, or phase changes", () => {
  const stream = {} as MediaStream;
  const otherStream = {} as MediaStream;
  const initial = { stream: null, active: false, phase: "playing" as const };
  const loading = updatePlaybackState(initial, stream, true, "loading");

  assert.notEqual(loading, initial);
  assert.deepEqual(loading, { stream, active: true, phase: "loading" });

  const playing = updatePlaybackState(loading, stream, true, "playing");
  const replaced = updatePlaybackState(playing, otherStream, true, "playing");
  const inactive = updatePlaybackState(replaced, null, false, "playing");

  assert.notEqual(playing, loading);
  assert.notEqual(replaced, playing);
  assert.notEqual(inactive, replaced);
  assert.deepEqual(inactive, { stream: null, active: false, phase: "playing" });
});

test("same-phase playback notification benchmark", () => {
  const stream = {} as MediaStream;
  const iterations = 100_000;
  let baselineState = { stream, active: true, phase: "playing" as const };
  let baselineUpdates = 0;
  const baselineStart = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    const next = { stream, active: true, phase: "playing" as const };
    if (next !== baselineState) baselineUpdates += 1;
    baselineState = next;
  }

  const baselineMs = performance.now() - baselineStart;
  let optimizedState = { stream, active: true, phase: "playing" as const };
  let optimizedUpdates = 0;
  const optimizedStart = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    const next = updatePlaybackState(optimizedState, stream, true, "playing");
    if (next !== optimizedState) optimizedUpdates += 1;
    optimizedState = next;
  }

  const optimizedMs = performance.now() - optimizedStart;

  assert.equal(baselineUpdates, iterations);
  assert.equal(optimizedUpdates, 0);
  console.info(
    `same-phase notifications: ${baselineUpdates} → ${optimizedUpdates} state updates `
    + `(${iterations} events; baseline ${baselineMs.toFixed(2)} ms, optimized ${optimizedMs.toFixed(2)} ms)`,
  );
});
