export const ROOM_ID_PATTERN = "^[A-Za-z0-9_-]{8,64}$";

const roomIdRegex = new RegExp(ROOM_ID_PATTERN);

export function isValidRoomId(roomId: string): boolean {
  return roomIdRegex.test(roomId);
}
