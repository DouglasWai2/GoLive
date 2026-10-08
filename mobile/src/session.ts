import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_TOKEN_KEY = "golive-device-token";

export function loadDeviceToken(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_TOKEN_KEY);
}

export function saveDeviceToken(token: string): Promise<void> {
  return AsyncStorage.setItem(DEVICE_TOKEN_KEY, token);
}

export function clearDeviceToken(): Promise<void> {
  return AsyncStorage.removeItem(DEVICE_TOKEN_KEY);
}
