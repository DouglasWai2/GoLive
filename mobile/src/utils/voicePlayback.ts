export type VoicePlaybackSettings = {
  volume: number;
  muted: boolean;
};

export const DEFAULT_VOICE_PLAYBACK_SETTINGS: VoicePlaybackSettings = {
  volume: 1,
  muted: false,
};

export function getVoicePlaybackVolume(
  settings: VoicePlaybackSettings,
  globalVolume: number,
  deafened: boolean,
): number {
  return deafened || settings.muted ? 0 : settings.volume * globalVolume;
}
