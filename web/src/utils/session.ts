const DEVICE_TOKEN_KEY = "golive-device-token";
const SAVED_ROOM_KEY = "golive-saved-room";

export function loadDeviceToken(): string | null {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY); } catch { return null; }
}

export function saveDeviceRoom(roomId: string, deviceToken: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
  localStorage.setItem(SAVED_ROOM_KEY, roomId);
}

export function clearSavedRoom(): void {
  localStorage.removeItem(SAVED_ROOM_KEY);
}

export function clearDeviceToken(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY);
  clearSavedRoom();
}
