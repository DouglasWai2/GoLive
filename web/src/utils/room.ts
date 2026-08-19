export function createRoomId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function roomFromPath(): string | null {
  const match = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]{1,64})\/?$/);
  return match?.[1] ?? null;
}

export function goToRoom(roomId: string) {
  window.location.assign(`/room/${roomId}`);
}

export function normalizeRoomCode(input: string): string {
  return input.trim().replace(/^.*\/room\//, "");
}