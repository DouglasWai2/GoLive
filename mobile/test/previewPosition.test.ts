import assert from "node:assert/strict";
import test from "node:test";
import { clampPreviewPosition } from "../src/utils/previewPosition";

test("clamps a dragged preview within the stage edges", () => {
  const stage = { width: 360, height: 640 };
  const preview = { width: 120, height: 75 };

  assert.deepEqual(
    clampPreviewPosition({ x: -1000, y: -1000 }, stage, preview),
    { x: -220, y: -481 },
  );
  assert.deepEqual(
    clampPreviewPosition({ x: 1000, y: 1000 }, stage, preview),
    { x: 4, y: 68 },
  );
});

test("keeps the preview's initial bottom-right placement in bounds", () => {
  assert.deepEqual(
    clampPreviewPosition(
      { x: 0, y: 0 },
      { width: 360, height: 640 },
      { width: 120, height: 75 },
    ),
    { x: 0, y: 0 },
  );
});
