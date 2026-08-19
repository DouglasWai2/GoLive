import { ScreenIcon, UsersIcon } from "../icons";
import { VideoTile } from "../VideoTile";
import type { Peer, RemoteVideoStats } from "../../types";

type VideoStageProps = {
  localStream: MediaStream | null;
  peers: Peer[];
  remoteStreams: Record<string, MediaStream>;
  connectionStates: Record<string, RTCPeerConnectionState>;
  remoteStats: Record<string, RemoteVideoStats | null>;
  localQuality: string | null;
  localName: string;
};

export function VideoStage({ localStream, peers, remoteStreams, connectionStates, remoteStats, localQuality, localName }: VideoStageProps) {
  const activeSharer = peers.find((peer) => peer.sharing);
  const remoteTiles = peers.filter((peer) => remoteStreams[peer.id]);

  return (
    <section className="stage">
      <div className="stage-heading">
        <div>
          <p className="eyebrow"><span /> Live room</p>
          <h1>{localStream ? "You are presenting" : activeSharer ? `${activeSharer.name} is presenting` : "Ready when you are"}</h1>
        </div>
        <div className="people-count"><UsersIcon /><strong>{peers.length + 1}</strong> in room</div>
      </div>

      <div className={`video-grid ${localStream || remoteTiles.length ? "has-video" : ""}`}>
        {localStream && <VideoTile stream={localStream} name={localName} local qualityLabel={localQuality} />}
        {remoteTiles.map((peer) => (
          <VideoTile
            key={peer.id}
            stream={remoteStreams[peer.id]!}
            name={peer.name}
            state={connectionStates[peer.id]}
            stats={remoteStats[peer.id] ?? null}
          />
        ))}
        {!localStream && remoteTiles.length === 0 && (
          <div className="empty-stage">
            <div className="screen-outline"><ScreenIcon size={38} /><span className="scan-line" /></div>
            <h2>{activeSharer ? "Connecting to the screen..." : "No screen on air"}</h2>
            <p>{activeSharer ? "A secure peer-to-peer connection is being established." : "Share this room link, then choose a window or display to begin."}</p>
          </div>
        )}
      </div>
    </section>
  );
}