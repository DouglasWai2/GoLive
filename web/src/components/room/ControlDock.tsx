import { useState } from "react";
import { ScreenIcon } from "../icons";
import type { Peer, ShareSettings, SocketStatus } from "../../types";
import { formatBitrate, formatResolution } from "@golive/core";
import { ShareSettingsPanel } from "./ShareSettingsPanel";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: MediaStream | null;
  isStartingShare: boolean;
  peers: Peer[];
  activeSettings: ShareSettings | null;
  onStartShare: (settings: ShareSettings) => void;
  onStopShare: () => void;
};

export function ControlDock({
  name,
  status,
  localStream,
  isStartingShare,
  peers,
  activeSettings,
  onStartShare,
  onStopShare,
}: ControlDockProps) {
  const [showSettings, setShowSettings] = useState(false);

  const activeSharer = peers.find((peer) => peer.sharing);
  const canShare = status === "connected" && !activeSharer && !localStream && !isStartingShare;

  const startShare = (settings: ShareSettings) => {
    setShowSettings(false);
    onStartShare(settings);
  };

  return (
    <footer className="control-dock">
      <div className="you-chip"><span>{name.slice(0, 1).toUpperCase()}</span><div><small>YOU</small><strong>{name}</strong></div></div>

      <div className="share-control">
        {localStream ? (
          <div className="sharing-state">
            {activeSettings && (
              <span className="quality-badge">
                {formatResolution(activeSettings.width, activeSettings.height)}
                <i /> {activeSettings.frameRate} fps
                <i /> {formatBitrate(activeSettings.maxBitrate)}
              </span>
            )}
            <button className="stop-button" onClick={onStopShare}><span /> Stop sharing</button>
          </div>
        ) : showSettings ? (
          <ShareSettingsPanel
            isStarting={isStartingShare}
            onStart={startShare}
            onCancel={() => setShowSettings(false)}
          />
        ) : (
          <button
            className="primary-button"
            onClick={() => setShowSettings(true)}
            disabled={!canShare}
          >
            <ScreenIcon /> {isStartingShare ? "Choose a screen..." : activeSharer ? "Screen in use" : "Share screen"}
          </button>
        )}
      </div>

      <div className="privacy-note"><i>↗</i><span><strong>Direct connection</strong><small>Media never touches our server</small></span></div>
    </footer>
  );
}