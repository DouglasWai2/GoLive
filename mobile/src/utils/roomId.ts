export function createRoomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";

  for (let i = 0; i < 8; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }

  return out;
}