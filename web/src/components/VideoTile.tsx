import { useEffect, useRef } from "react";
import type { RemoteVideoStats } from "../types";
import { StreamStats } from "./room/StreamStats";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  local?: boolean;
  state?: RTCPeerConnectionState;
  qualityLabel?: string | null;
  stats?: RemoteVideoStats | null;
};

export function VideoTile({ stream, name, local = false, state, qualityLabel, stats }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

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
    </article>
  );
}