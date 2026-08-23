import type { ShareSettings } from "./types";

export type ResolutionOption = {
  label: string;
  width: number;
  height: number;
};

export type FrameRateOption = {
  label: string;
  value: number;
};

export type BitrateOption = {
  label: string;
  value: number;
};

export const resolutionOptions: ResolutionOption[] = [
  { label: "1080p", width: 1920, height: 1080 },
  { label: "720p", width: 1280, height: 720 },
  { label: "480p", width: 854, height: 480 },
];

export const frameRateOptions: FrameRateOption[] = [
  { label: "60", value: 60 },
  { label: "30", value: 30 },
  { label: "15", value: 15 },
];

export const bitrateOptions: BitrateOption[] = [
  { label: "8 Mbps", value: 8_000_000 },
  { label: "5 Mbps", value: 5_000_000 },
  { label: "3 Mbps", value: 3_000_000 },
  { label: "1.5 Mbps", value: 1_500_000 },
  { label: "800 kbps", value: 800_000 },
];

export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  width: 1280,
  height: 720,
  frameRate: 30,
  maxBitrate: 3_000_000,
};

export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(bps % 1_000_000 === 0 ? 0 : 1)} Mbps`;
  }

  return `${Math.round(bps / 1_000)} kbps`;
}

export function formatResolution(width: number, height: number): string {
  return resolutionOptions.find(
    (option) => option.width === width && option.height === height,
  )?.label ?? `${width}×${height}`;
}

export function formatKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function formatCodec(mimeType: string | null): string {
  if (!mimeType) return "—";
  return mimeType.replace(/^video\//, "").toUpperCase();
}

export function formatConnectionRoute(route: string | null): string {
  if (route === "TURN relay") return "TURN";
  if (route === "Direct P2P via STUN") return "STUN";
  if (route === "Direct P2P") return "P2P";
  return "…";
}
