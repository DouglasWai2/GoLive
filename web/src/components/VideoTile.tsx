import { useEffect, useRef, useState } from "react";
import type { PeerConnectionState, RemoteVideoStats } from "@golive/core";
import { FullscreenIcon } from "./icons";
import { StreamStats, type OutboundStatsEntry } from "./room/StreamStats";
import StatsButton from "./room/StatsButton";
import { VolumeControl } from "./room/VolumeControl";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  local?: boolean;
  state?: PeerConnectionState;
  qualityLabel?: string | null;
  stats?: RemoteVideoStats | null;
  outboundStats?: OutboundStatsEntry[];
  volume?: number;
  muted?: boolean;
  statsEnabled?: boolean;
  onVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleStats?: () => void;
  onFullscreen?: (video: HTMLVideoElement) => void;
};

function isNotAllowedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

async function startPlayback(
  video: HTMLVideoElement,
  muted: boolean,
  hasAudio: boolean,
  isCurrent: () => boolean,
  setAudioBlocked: (blocked: boolean) => void,
) {
  video.muted = muted;

  try {
    await video.play();
    if (!isCurrent()) return;
    setAudioBlocked(false);
  } catch (error) {
    if (!isNotAllowedError(error) || !isCurrent()) return;

    video.muted = true;
    setAudioBlocked(hasAudio && !muted);

    try {
      await video.play();
    } catch {
      // The user-facing action below remains available for a gesture-driven retry.
    }
  }
}

export function VideoTile({ stream, name, local = false, state, qualityLabel, stats, outboundStats = [], volume = 1, muted = false, statsEnabled = true, onVolumeChange, onToggleMute, onToggleStats, onFullscreen }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const hasAudio = stream.getAudioTracks().length > 0;

  useEffect(() => {
    const video = videoRef.current;
    let active = true;

    if (video) {
      video.srcObject = stream;
      video.volume = volume;
      void startPlayback(video, local || muted, hasAudio, () => (
        active && video.srcObject === stream
      ), (blocked) => {
        if (active) setAudioBlocked(blocked);
      });
    }

    return () => {
      active = false;
      if (video?.srcObject === stream) video.srcObject = null;
    };
  }, [hasAudio, stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    const shouldMute = local || muted || audioBlocked;
    video.volume = volume;
    video.muted = shouldMute;

    if (!local && hasAudio && !shouldMute) {
      void video.play().catch((error: unknown) => {
        if (active && video.srcObject === stream && isNotAllowedError(error)) {
          video.muted = true;
          setAudioBlocked(true);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [audioBlocked, hasAudio, local, muted, stream, volume]);

  const hearAudio = async () => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = false;

    try {
      await video.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  };

  return (
    <article className="video-tile">
      <video ref={videoRef} autoPlay playsInline muted={local || muted || audioBlocked} />
      {!local && hasAudio && audioBlocked && !muted && (
        <button type="button" className="audio-playback-action" onClick={() => void hearAudio()}>
          Tap to hear shared audio
        </button>
      )}
      <div className="video-meta">
        <span className="live-dot" />
        <strong>{local ? "Your screen" : `${name}'s screen`}</strong>
        {local && qualityLabel && <span className="peer-state">{qualityLabel}</span>}
        {state && <span className="peer-state">{state}</span>}
      </div>
      {!local && stats && <StreamStats stats={stats} />}
      {local && statsEnabled && outboundStats.length > 0 && (
        <StreamStats outbound={outboundStats} />
      )}
      {((local && onToggleStats) ||
        (!local && (onVolumeChange || onToggleStats || onFullscreen))) && (
        <div className="tile-controls">
          {onToggleStats && <StatsButton statsEnabled={statsEnabled} toggleStats={onToggleStats} />}
          {hasAudio && onVolumeChange && onToggleMute && (
            <VolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />
          )}
          {onFullscreen && (
            <button
              className="icon-button"
              onClick={() => {
                if (videoRef.current) onFullscreen(videoRef.current);
              }}
              title="Fullscreen"
              aria-label="Fullscreen"
            >
              <FullscreenIcon />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
