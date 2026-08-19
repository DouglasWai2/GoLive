import { ScreenIcon } from "../icons";
import type { Peer, SocketStatus } from "../../types";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: MediaStream | null;
  isStartingShare: boolean;
  peers: Peer[];
  onStartShare: () => void;
  onStopShare: () => void;
};

export function ControlDock({ name, status, localStream, isStartingShare, peers, onStartShare, onStopShare }: ControlDockProps) {
  const activeSharer = peers.find((peer) => peer.sharing);
  const canShare = status === "connected" && !activeSharer && !localStream && !isStartingShare;

  return (
    <footer className="control-dock">
      <div className="you-chip"><span>{name.slice(0, 1).toUpperCase()}</span><div><small>YOU</small><strong>{name}</strong></div></div>
      {localStream ? (
        <button className="stop-button" onClick={onStopShare}><span /> Stop sharing</button>
      ) : (
        <button className="primary-button" onClick={onStartShare} disabled={!canShare}>
          <ScreenIcon /> {isStartingShare ? "Choose a screen..." : activeSharer ? "Screen in use" : "Share screen"}
        </button>
      )}
      <div className="privacy-note"><i>↗</i><span><strong>Direct connection</strong><small>Media never touches our server</small></span></div>
    </footer>
  );
}