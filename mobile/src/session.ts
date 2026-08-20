import AsyncStorage from "@react-native-async-storage/async-storage";
import { decode as decodeBase64 } from "base-64";

export type StoredSession = {
  name: string;
  token: string;
};

const PREFIX = "golive-session:";

function sessionKey(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export async function saveSession(
  roomId: string,
  name: string,
  token: string,
): Promise<void> {
  await AsyncStorage.setItem(sessionKey(roomId), JSON.stringify({ name, token }));
}

export async function loadSession(roomId: string): Promise<StoredSession | null> {
  const raw = await AsyncStorage.getItem(sessionKey(roomId));

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;

    if (typeof parsed.name !== "string" || typeof parsed.token !== "string") {
      return null;
    }

    if (isTokenExpired(parsed.token)) {
      await clearSession(roomId);
      return null;
    }

    return { name: parsed.name, token: parsed.token };
  } catch {
    return null;
  }
}

export async function clearSession(roomId: string): Promise<void> {
  await AsyncStorage.removeItem(sessionKey(roomId));
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(decodeBase64(token.split(".")[1])) as {
      exp?: number;
    };

    if (typeof payload.exp !== "number") return false;

    return payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}