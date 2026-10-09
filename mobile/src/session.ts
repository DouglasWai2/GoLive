import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_TOKEN_KEY = "golive-device-token";
const DEVICE_NAME_KEY = "golive-name";

export function loadDeviceToken(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_TOKEN_KEY);
}

export function saveDeviceToken(token: string): Promise<void> {
  return AsyncStorage.setItem(DEVICE_TOKEN_KEY, token);
}

export function loadDeviceName(): Promise<string> {
  return AsyncStorage.getItem(DEVICE_NAME_KEY).then((name) => name ?? "");
}

export function saveDeviceName(name: string): Promise<void> {
  return AsyncStorage.setItem(DEVICE_NAME_KEY, name);
}

export function clearDeviceToken(): Promise<void> {
  return AsyncStorage.removeItem(DEVICE_TOKEN_KEY);
}
