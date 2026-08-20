import { useEffect, useRef } from "react";
import type { RemoteVideoStats } from "../types";
import { FullscreenIcon } from "./icons";
import { StreamStats } from "./room/StreamStats";
import StatsButton from "./room/StatsButton";
import { VolumeControl } from "./room/VolumeControl";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  local?: boolean;
  state?: RTCPeerConnectionState;
  qualityLabel?: string | null;
  stats?: RemoteVideoStats | null;
  volume?: number;
  muted?: boolean;
  statsEnabled?: boolean;
  onVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleStats?: () => void;
  onFullscreen?: () => void;
};

export function VideoTile({ stream, name, local = false, state, qualityLabel, stats, volume = 1, muted = false, statsEnabled = true, onVolumeChange, onToggleMute, onToggleStats, onFullscreen }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (local || !videoRef.current) return;
    videoRef.current.volume = volume;
    videoRef.current.muted = muted;
  }, [local, volume, muted]);

  return (
    <article className="video-tile">
      <video ref={videoRef} autoPlay playsInline muted={local} />
      <div className="video-meta">
        <span className="live-dot" />
        <strong>{local ? "Your screen" : `${name}'s screen`}</strong>
        {local && qualityLabel && <span className="peer-state">{qualityLabel}</span>}
        {state && <span className="peer-state">{state}</span>}
      </div>
      {!local && stats && <StreamStats stats={stats} />}
      {!local && (onVolumeChange || onToggleStats || onFullscreen) && (
        <div className="tile-controls">
          {onToggleStats && <StatsButton statsEnabled={statsEnabled} toggleStats={onToggleStats} />}
          {onVolumeChange && onToggleMute && (
            <VolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />
          )}
          {onFullscreen && (
            <button className="icon-button" onClick={onFullscreen} title="Fullscreen" aria-label="Fullscreen">
              <FullscreenIcon />
            </button>
          )}
        </div>
      )}
    </article>
  );
}