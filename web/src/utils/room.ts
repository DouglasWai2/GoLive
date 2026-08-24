import { buildInviteUrl, parseInviteUrl } from "@golive/core";

export function createRoomId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function roomFromPath(): string | null {
  const match = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]{8,64})\/?$/);
  return match?.[1] ?? null;
}

export function inviteTokenFromUrl(): string | null {
  return parseInviteUrl(window.location.href)?.inviteToken ?? null;
}

export function clearInviteTokenFromUrl(): void {
  const url = new URL(window.location.href);

  if (!url.searchParams.has("token")) return;

  url.searchParams.delete("token");
  window.history.replaceState({}, "", url);
}

export function goToRoom(roomId: string): void {
  window.location.assign(`/room/${roomId}`);
}

export function roomTargetFromInput(input: string): string | null {
  const parsed = parseInviteUrl(input.trim());
  if (!parsed) return null;

  return buildInviteUrl("", parsed.roomId, parsed.inviteToken);
}
