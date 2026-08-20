export type StoredSession = {
  name: string;
  token: string;
  inviteToken?: string;
};

const PREFIX = "golive-session:";

function sessionKey(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export function saveSession(
  roomId: string,
  name: string,
  token: string,
  inviteToken?: string,
): void {
  const session: StoredSession = inviteToken
    ? { name, token, inviteToken }
    : { name, token };

  localStorage.setItem(sessionKey(roomId), JSON.stringify(session));
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

    const inviteToken =
      typeof parsed.inviteToken === "string" && !isTokenExpired(parsed.inviteToken)
        ? parsed.inviteToken
        : undefined;

    return { name: parsed.name, token: parsed.token, inviteToken };
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