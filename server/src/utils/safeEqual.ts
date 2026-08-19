import {
  timingSafeEqual,
} from "node:crypto";

export function safeEqual(
  value: string,
  expected: string,
): boolean {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}