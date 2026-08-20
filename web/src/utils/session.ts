export type StoredSession = {
  name: string;
  token: string;
};

const PREFIX = "golive-session:";

function sessionKey(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export function saveSession(roomId: string, name: string, token: string): void {
  localStorage.setItem(sessionKey(roomId), JSON.stringify({ name, token }));
}

export function loadSession(roomId: string): StoredSession | null {
  const raw = localStorage.getItem(sessionKey(roomId));

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;

    if (typeof parsed.name !== "string" || typeof parsed.token !== "string") {
      return null;
    }

    if (isTokenExpired(parsed.token)) {
      clearSession(roomId);
      return null;
    }

    return { name: parsed.name, token: parsed.token };
  } catch {
    return null;
  }
}

export function clearSession(roomId: string): void {
  localStorage.removeItem(sessionKey(roomId));
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { exp?: number };

    if (typeof payload.exp !== "number") return false;

    return payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}