/**
 * Computes the MediaProjection source scale needed to avoid capturing pixels
 * that the selected output constraints will immediately discard.
 *
 * react-native-webrtc's Android capturer applies this fraction to both display
 * dimensions before creating its screen-capture surface. The sender uses the
 * selected max width/height afterward, so this preserves the same output raster
 * while reducing source capture and encode work.
 */
export function getScreenCaptureResolutionScale(
  displayWidthPx: number,
  displayHeightPx: number,
  maxWidth: number,
  maxHeight: number,
): number {
  if (
    !Number.isFinite(displayWidthPx)
    || !Number.isFinite(displayHeightPx)
    || !Number.isFinite(maxWidth)
    || !Number.isFinite(maxHeight)
    || displayWidthPx <= 0
    || displayHeightPx <= 0
    || maxWidth <= 0
    || maxHeight <= 0
  ) {
    return 1;
  }

  const scaleForOrientation = (width: number, height: number) =>
    Math.min(1, maxWidth / width, maxHeight / height);

  // Android reuses this scale when the display rotates. Use the larger
  // orientation-specific bound so rotation never captures below the output
  // raster that the sender would have produced from the full display.
  return Math.max(
    scaleForOrientation(displayWidthPx, displayHeightPx),
    scaleForOrientation(displayHeightPx, displayWidthPx),
  );
}
