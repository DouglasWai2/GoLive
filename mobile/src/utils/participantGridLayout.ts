export function getParticipantGridColumns(
  slotCount: number,
  width: number,
  height: number,
): number {
  if (slotCount <= 1) return 1;

  const isLandscape = width > height;
  if (isLandscape) return slotCount <= 4 ? 2 : 3;
  if (slotCount <= 2) return 1;
  if (slotCount <= 6) return 2;
  return 3;
}
