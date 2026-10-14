import assert from "node:assert/strict";
import test from "node:test";
import { getScreenCaptureResolutionScale } from "../src/utils/screenCapture";

test("matches the existing sender output raster for landscape capture", () => {
  const display = { width: 2400, height: 1080 };
  const outputCap = { width: 1280, height: 720 };
  const baselineSenderScale = Math.max(
    display.width / outputCap.width,
    display.height / outputCap.height,
  );
  const scale = getScreenCaptureResolutionScale(
    display.width,
    display.height,
    outputCap.width,
    outputCap.height,
  );

  const baselineOutput = {
    width: display.width / baselineSenderScale,
    height: display.height / baselineSenderScale,
  };
  const optimizedCapture = {
    width: display.width * scale,
    height: display.height * scale,
  };

  assert.equal(scale, 1280 / 2400);
  assert.deepEqual(optimizedCapture, baselineOutput);
  assert.equal(display.width * display.height, 2_592_000);
  assert.equal(optimizedCapture.width * optimizedCapture.height, 737_280);
  assert.equal(
    Math.round((1 - (scale ** 2)) * 100),
    72,
    "selected 720p cap should reduce per-frame source pixels by about 72%",
  );
});

test("preserves the output raster for portrait capture and does not upscale", () => {
  const display = { width: 1080, height: 2400 };
  const outputCap = { width: 1280, height: 720 };
  const portraitScale = getScreenCaptureResolutionScale(
    display.width,
    display.height,
    outputCap.width,
    outputCap.height,
  );
  const baselineSenderScale = Math.max(
    display.width / outputCap.width,
    display.height / outputCap.height,
  );

  const landscapeScale = getScreenCaptureResolutionScale(
    display.height,
    display.width,
    outputCap.width,
    outputCap.height,
  );
  assert.equal(portraitScale, 1280 / 2400);
  assert.equal(landscapeScale, portraitScale);

  const captured = {
    width: display.width * portraitScale,
    height: display.height * portraitScale,
  };
  const optimizedSenderScale = Math.max(
    1,
    captured.width / outputCap.width,
    captured.height / outputCap.height,
  );
  assert.deepEqual(
    {
      width: captured.width / optimizedSenderScale,
      height: captured.height / optimizedSenderScale,
    },
    {
      width: display.width / baselineSenderScale,
      height: display.height / baselineSenderScale,
    },
  );

  assert.equal(getScreenCaptureResolutionScale(720, 480, 1280, 720), 1);
});

test("falls back to full-resolution capture for invalid display dimensions", () => {
  assert.equal(getScreenCaptureResolutionScale(0, 2400, 1280, 720), 1);
  assert.equal(getScreenCaptureResolutionScale(2400, 1080, Number.NaN, 720), 1);
});
