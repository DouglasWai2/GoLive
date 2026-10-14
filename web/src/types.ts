export * from "@golive/core";

export type CallStageSource = "local" | "remote" | "none";

export type VoicePlaybackSettings = {
  volume: number;
  muted: boolean;
};
