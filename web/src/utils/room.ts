export function createRoomId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function roomFromPath(): string | null {
  const match = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]{1,64})\/?$/);
  return match?.[1] ?? null;
}

export function goToRoom(roomId: string): void {
  window.location.assign(`/room/${roomId}`);
}

export function roomTargetFromInput(input: string): string | null {
  const trimmed = input.trim();

  const roomMatch = trimmed.match(/(?:\/room\/)([a-zA-Z0-9_-]{1,64})/);
  if (roomMatch) {
    return `/room/${roomMatch[1]}`;
  }

  if (/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) {
    return `/room/${trimmed}`;
  }

  return null;
}