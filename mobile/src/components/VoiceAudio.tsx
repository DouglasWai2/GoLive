import { useEffect, useRef } from "react";
import { NativeModules, Platform } from "react-native";

type VoiceAudioProps = {
  tracks: Record<string, any>;
  deafened: boolean;
  activeMediaCount: number;
};

const setLoudspeakerPreferred = (enabled: boolean) => {
  if (Platform.OS === "android") {
    NativeModules.WebRTCModule?.setLoudspeakerPreferred?.(enabled);
  }
};

/**
 * VoiceAudio handles playback of remote voice tracks on mobile.
 * Uses track._setVolume() for per-track volume control (deafen).
 * No audio element needed - react-native-webrtc handles playback natively.
 */
export function VoiceAudio({ tracks, deafened, activeMediaCount }: VoiceAudioProps) {
  const tracksRef = useRef(tracks);
  const deafenedRef = useRef(deafened);

  tracksRef.current = tracks;
  deafenedRef.current = deafened;

  useEffect(() => {
    setLoudspeakerPreferred(true);
    return () => setLoudspeakerPreferred(false);
  }, []);

  useEffect(() => {
    setLoudspeakerPreferred(true);
  }, [activeMediaCount]);

  useEffect(() => {
    const volume = deafened ? 0 : 1;

    for (const [peerId, track] of Object.entries(tracks)) {
      if (track && typeof track._setVolume === "function") {
        try {
          track._setVolume(volume);
        } catch (e) {
          console.warn(`VoiceAudio: failed to set volume for ${peerId}`, e);
        }
      }
    }
  }, [deafened, tracks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const track of Object.values(tracksRef.current)) {
        if (track && typeof track._setVolume === "function") {
          try {
            track._setVolume(1);
          } catch {
            // ignore
          }
        }
      }
    };
  }, []);

  return null;
}
