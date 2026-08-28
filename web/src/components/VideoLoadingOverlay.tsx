import type { PeerConnectionState } from "@golive/core";
import type { VideoPlaybackPhase } from "../hooks/useVideoPlaybackState";
import { ScreenIcon } from "./icons";

type VideoLoadingOverlayProps = {
  phase: VideoPlaybackPhase;
  connectionState?: PeerConnectionState;
  playbackBlocked?: boolean;
  onRetryPlayback?: () => void;
};

function loadingCopy(phase: VideoPlaybackPhase, connectionState?: PeerConnectionState) {
  if (connectionState === "new" || connectionState === "connecting") {
    return {
      title: "Negotiating secure connection",
      message: "Checking available peer and relay paths.",
    };
  }

  if (connectionState === "disconnected") {
    return {
      title: "Reconnecting stream",
      message: "The secure media connection was interrupted.",
    };
  }

  if (connectionState === "failed") {
    return {
      title: "Trying another connection path",
      message: "The direct media path could not be established.",
    };
  }

  if (phase === "buffering") {
    return {
      title: "Stream interrupted",
      message: "Waiting for video to resume.",
    };
  }

  if (phase === "ended") {
    return {
      title: "Screen stream ended",
      message: "Waiting for the presenter to reconnect.",
    };
  }

  if (phase === "error") {
    return {
      title: "Video could not play",
      message: "The browser could not render this stream.",
    };
  }

  return {
    title: "Waiting for video",
    message: "The connection is ready; waiting for the first frame.",
  };
}

export function VideoLoadingOverlay({ phase, connectionState, playbackBlocked = false, onRetryPlayback }: VideoLoadingOverlayProps) {
  if (phase === "playing" && !playbackBlocked && connectionState !== "disconnected" && connectionState !== "failed") {
    return null;
  }

  const copy = loadingCopy(phase, connectionState);

  return (
    <div className="video-loading-overlay" role="status" aria-live="polite">
      <div className="stream-loading-screen" aria-hidden="true">
        <ScreenIcon size={30} />
        <span />
      </div>
      <strong>{playbackBlocked ? "Playback paused" : copy.title}</strong>
      <small>{playbackBlocked ? "Playback did not start automatically. Select play to retry." : copy.message}</small>
      {playbackBlocked && onRetryPlayback && (
        <button type="button" className="video-playback-action" onClick={onRetryPlayback}>
          Play video
        </button>
      )}
    </div>
  );
}
