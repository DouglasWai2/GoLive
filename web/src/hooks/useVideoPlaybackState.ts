import { useEffect, useState, type RefObject } from "react";

export type VideoPlaybackPhase = "loading" | "buffering" | "playing" | "ended" | "error";

type PlaybackState = {
  stream: MediaStream | null;
  active: boolean;
  phase: VideoPlaybackPhase;
};

export function useVideoPlaybackState(
  videoRef: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  active = true,
): VideoPlaybackPhase {
  const [playback, setPlayback] = useState<PlaybackState>({
    stream: null,
    active: false,
    phase: "playing",
  });

  useEffect(() => {
    const video = videoRef.current;

    if (!active || !stream || !video) {
      setPlayback({ stream: null, active: false, phase: "playing" });
      return;
    }

    let listening = true;
    let frameRequest: number | null = null;
    const supportsFrameCallback = typeof video.requestVideoFrameCallback === "function";
    const isCurrent = () => listening && video.srcObject === stream;
    const setPhase = (phase: VideoPlaybackPhase) => {
      if (listening) setPlayback({ stream, active: true, phase });
    };
    const hasCurrentFrame = () => (
      isCurrent()
      && video.readyState >= 2
      && video.videoWidth > 0
      && video.videoHeight > 0
    );
    const markFallbackFrameReady = () => {
      if (hasCurrentFrame()) setPhase("playing");
    };
    const requestFrame = () => {
      if (!listening || frameRequest !== null) return;

      if (!supportsFrameCallback) {
        markFallbackFrameReady();
        return;
      }

      frameRequest = video.requestVideoFrameCallback(() => {
        frameRequest = null;
        if (isCurrent()) setPhase("playing");
      });
    };
    const awaitFrame = () => {
      if (supportsFrameCallback) requestFrame();
      else markFallbackFrameReady();
    };
    const onWaiting = () => {
      if (!isCurrent()) return;
      setPhase("buffering");
      requestFrame();
    };
    const onEmptied = () => setPhase("loading");
    const onEnded = () => setPhase("ended");
    const onError = () => setPhase("error");
    const onTrackMuted = () => {
      if (!isCurrent()) return;
      setPhase("buffering");
      requestFrame();
    };

    setPhase("loading");
    video.addEventListener("loadeddata", awaitFrame);
    video.addEventListener("canplay", awaitFrame);
    video.addEventListener("playing", awaitFrame);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("emptied", onEmptied);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);

    const tracks = stream.getVideoTracks();
    for (const track of tracks) {
      track.addEventListener("mute", onTrackMuted);
      track.addEventListener("unmute", awaitFrame);
      track.addEventListener("ended", onEnded);
    }

    requestFrame();

    return () => {
      listening = false;
      if (frameRequest !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameRequest);
      }
      video.removeEventListener("loadeddata", awaitFrame);
      video.removeEventListener("canplay", awaitFrame);
      video.removeEventListener("playing", awaitFrame);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("emptied", onEmptied);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);

      for (const track of tracks) {
        track.removeEventListener("mute", onTrackMuted);
        track.removeEventListener("unmute", awaitFrame);
        track.removeEventListener("ended", onEnded);
      }
    };
  }, [active, stream, videoRef]);

  if (!active || !stream) return "playing";
  if (!playback.active || playback.stream !== stream) return "loading";
  return playback.phase;
}
