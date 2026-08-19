import { useEffect, useRef } from "react";
import type { RemoteVideoStats } from "../types";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  local?: boolean;
  state?: RTCPeerConnectionState;
  stats?: RemoteVideoStats | null;
  qualityLabel?: string | null;
};

export function VideoTile({ stream, name, local = false, state, stats, qualityLabel }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

  const statText =
    stats?.width && stats.height
      ? `${stats.width}×${stats.height}${stats.fps ? ` · ${stats.fps} fps` : ""}${stats.bitrateKbps ? ` · ${formatKbps(stats.bitrateKbps)}` : ""}`
      : null;

  return (
    <article className="video-tile">
      <video ref={videoRef} autoPlay playsInline muted={local} />
      <div className="video-meta">
        <span className="live-dot" />
        <strong>{local ? "Your screen" : `${name}'s screen`}</strong>
        {local && qualityLabel && <span className="peer-state">{qualityLabel}</span>}
        {!local && statText && <span className="peer-state">{statText}</span>}
        {state && <span className="peer-state">{state}</span>}
      </div>
    </article>
  );
}

function formatKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}