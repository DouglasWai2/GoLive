const DEVICE_TOKEN_KEY = "golive-device-token";
const SAVED_ROOM_KEY = "golive-saved-room";
const DEVICE_NAME_KEY = "golive-name";

export function loadDeviceToken(): string | null {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY); } catch { return null; }
}

export function saveDeviceRoom(roomId: string, deviceToken: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
  localStorage.setItem(SAVED_ROOM_KEY, roomId);
}

export function loadSavedRoom(): string | null {
  try { return localStorage.getItem(SAVED_ROOM_KEY); } catch { return null; }
}

export function loadDeviceName(): string {
  try { return localStorage.getItem(DEVICE_NAME_KEY) ?? ""; } catch { return ""; }
}

export function saveDeviceName(name: string): void {
  localStorage.setItem(DEVICE_NAME_KEY, name);
}

export function clearSavedRoom(): void {
  localStorage.removeItem(SAVED_ROOM_KEY);
}

export function clearDeviceToken(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY);
  clearSavedRoom();
}
