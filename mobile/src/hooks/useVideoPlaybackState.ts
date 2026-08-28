import { useCallback, useEffect, useState } from "react";
import type { MediaStream } from "@golive/core";

export type VideoPlaybackPhase = "loading" | "buffering" | "playing" | "ended" | "error";

type PlaybackState = {
  stream: MediaStream | null;
  active: boolean;
  phase: VideoPlaybackPhase;
};

type DimensionsChangeEvent = {
  nativeEvent: { width: number; height: number };
};

type ObservableVideoTrack = {
  addEventListener(type: "mute" | "unmute" | "ended", listener: () => void): void;
  removeEventListener(type: "mute" | "unmute" | "ended", listener: () => void): void;
};

export function useVideoPlaybackState(stream: MediaStream | null, active = true) {
  const [playback, setPlayback] = useState<PlaybackState>({
    stream: null,
    active: false,
    phase: "playing",
  });

  useEffect(() => {
    if (!active || !stream) {
      setPlayback({ stream: null, active: false, phase: "playing" });
      return;
    }

    const tracks = stream.getVideoTracks() as unknown as ObservableVideoTrack[];
    const setPhase = (phase: VideoPlaybackPhase) => {
      setPlayback({ stream, active: true, phase });
    };
    const onMuted = () => {
      setPlayback((current) => (
        current.stream === stream && current.phase === "playing"
          ? { stream, active: true, phase: "buffering" }
          : current
      ));
    };
    const onUnmuted = () => setPhase("playing");
    const onEnded = () => setPhase("ended");

    setPhase("loading");

    for (const track of tracks) {
      track.addEventListener("mute", onMuted);
      track.addEventListener("unmute", onUnmuted);
      track.addEventListener("ended", onEnded);
    }

    return () => {
      for (const track of tracks) {
        track.removeEventListener("mute", onMuted);
        track.removeEventListener("unmute", onUnmuted);
        track.removeEventListener("ended", onEnded);
      }
    };
  }, [active, stream]);

  const onDimensionsChange = useCallback(({ nativeEvent }: DimensionsChangeEvent) => {
    if (!active || !stream || nativeEvent.width <= 0 || nativeEvent.height <= 0) return;
    // The iOS renderer clears a newly attached track with a synthetic 2x2 black frame.
    if (nativeEvent.width === 2 && nativeEvent.height === 2) return;
    setPlayback({ stream, active: true, phase: "playing" });
  }, [active, stream]);

  let phase: VideoPlaybackPhase = "playing";
  if (active && stream) {
    phase = playback.active && playback.stream === stream ? playback.phase : "loading";
  }

  return { phase, onDimensionsChange };
}
