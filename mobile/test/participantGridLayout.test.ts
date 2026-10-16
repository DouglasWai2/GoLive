import assert from "node:assert/strict";
import test from "node:test";
import { getParticipantGridColumns } from "../src/utils/participantGridLayout";

test("stacks one or two participants in a portrait stage", () => {
  assert.equal(getParticipantGridColumns(1, 360, 600), 1);
  assert.equal(getParticipantGridColumns(2, 360, 600), 1);
});

test("adds columns as a portrait gallery fills up", () => {
  assert.equal(getParticipantGridColumns(3, 360, 600), 2);
  assert.equal(getParticipantGridColumns(6, 360, 600), 2);
  assert.equal(getParticipantGridColumns(7, 360, 600), 3);
  assert.equal(getParticipantGridColumns(9, 360, 600), 3);
});

test("uses a wider layout when the stage is landscape", () => {
  assert.equal(getParticipantGridColumns(2, 600, 360), 2);
  assert.equal(getParticipantGridColumns(4, 600, 360), 2);
  assert.equal(getParticipantGridColumns(5, 600, 360), 3);
});
