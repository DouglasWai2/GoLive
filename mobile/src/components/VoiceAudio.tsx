import { useEffect, useRef } from "react";
import { NativeModules, Platform } from "react-native";
import {
  DEFAULT_VOICE_PLAYBACK_SETTINGS,
  getVoicePlaybackVolume,
  type VoicePlaybackSettings,
} from "../utils/voicePlayback";

type VoiceAudioProps = {
  tracks: Record<string, any>;
  deafened: boolean;
  globalVolume: number;
  settings: Record<string, VoicePlaybackSettings>;
  activeMediaCount: number;
};

function setTrackVolume(peerId: string, track: any, volume: number) {
  if (!track || typeof track._setVolume !== "function") return;

  try {
    track._setVolume(volume);
  } catch (error) {
    console.warn(`VoiceAudio: failed to set volume for ${peerId}`, error);
  }
}

const setLoudspeakerPreferred = (enabled: boolean) => {
  if (Platform.OS === "android") {
    NativeModules.WebRTCModule?.setLoudspeakerPreferred?.(enabled);
  }
};

/**
 * VoiceAudio handles playback of remote voice tracks on mobile.
 * Uses track._setVolume() for per-participant, room-wide, and deafen volume.
 * No audio element needed - react-native-webrtc handles playback natively.
 */
export function VoiceAudio({ tracks, deafened, globalVolume, settings, activeMediaCount }: VoiceAudioProps) {
  const tracksRef = useRef(tracks);
  const previousTracksRef = useRef(tracks);

  tracksRef.current = tracks;

  useEffect(() => {
    setLoudspeakerPreferred(true);
    return () => setLoudspeakerPreferred(false);
  }, []);

  useEffect(() => {
    setLoudspeakerPreferred(true);
  }, [activeMediaCount]);

  useEffect(() => {
    for (const [peerId, previousTrack] of Object.entries(previousTracksRef.current)) {
      if (tracks[peerId] !== previousTrack) setTrackVolume(peerId, previousTrack, 1);
    }

    for (const [peerId, track] of Object.entries(tracks)) {
      const participantSettings = settings[peerId] ?? DEFAULT_VOICE_PLAYBACK_SETTINGS;
      setTrackVolume(
        peerId,
        track,
        getVoicePlaybackVolume(participantSettings, globalVolume, deafened),
      );
    }

    previousTracksRef.current = tracks;
  }, [deafened, globalVolume, settings, tracks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [peerId, track] of Object.entries(tracksRef.current)) {
        setTrackVolume(peerId, track, 1);
      }
    };
  }, []);

  return null;
}
