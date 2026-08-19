import { useEffect, useRef } from "react";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  local?: boolean;
  state?: RTCPeerConnectionState;
};

export function VideoTile({ stream, name, local = false, state }: VideoTileProps) {
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
        {state && <span className="peer-state">{state}</span>}
      </div>
    </article>
  );
}
