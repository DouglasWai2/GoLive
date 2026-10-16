export type PreviewPosition = { x: number; y: number };
export type PreviewSize = { width: number; height: number };

export function clampPreviewPosition(
  position: PreviewPosition,
  stage: PreviewSize,
  preview: PreviewSize,
  edgeMargin = 8,
  originRight = 12,
  originBottom = 76,
): PreviewPosition {
  if (stage.width <= 0 || stage.height <= 0 || preview.width <= 0 || preview.height <= 0) {
    return position;
  }

  const originX = stage.width - preview.width - originRight;
  const originY = stage.height - preview.height - originBottom;
  const minX = edgeMargin;
  const minY = edgeMargin;
  const maxX = Math.max(minX, stage.width - preview.width - edgeMargin);
  const maxY = Math.max(minY, stage.height - preview.height - edgeMargin);
  const left = Math.max(minX, Math.min(originX + position.x, maxX));
  const top = Math.max(minY, Math.min(originY + position.y, maxY));

  return { x: left - originX, y: top - originY };
}
