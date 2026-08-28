import { useState } from "react";
import {
  MicrophoneIcon,
  MicrophoneMutedIcon,
  ScreenIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from "../icons";
import type { Peer, ShareSettings, SocketStatus, VoiceState } from "../../types";
import { formatBitrate, formatResolution } from "@golive/core";
import { ShareSettingsPanel } from "./ShareSettingsPanel";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: MediaStream | null;
  isStartingShare: boolean;
  peers: Peer[];
  activeSettings: ShareSettings | null;
  voiceState: VoiceState;
  deafened: boolean;
  onStartShare: (settings: ShareSettings) => void;
  onStopShare: () => void;
  onSetMicrophoneMuted: (muted: boolean) => void;
  onToggleDeafen: () => void;
};

export function ControlDock({
  name,
  status,
  localStream,
  isStartingShare,
  peers,
  activeSettings,
  voiceState,
  deafened,
  onStartShare,
  onStopShare,
  onSetMicrophoneMuted,
  onToggleDeafen,
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
      <div className="identity-controls">
        <div className="you-chip"><span>{name.slice(0, 1).toUpperCase()}</span><div><small>YOU</small><strong>{name}</strong></div></div>
        <div className="voice-controls" aria-label="Room voice controls">
          <button
            type="button"
            className={`icon-button ${voiceState.micMuted ? "muted" : "active"}`}
            disabled={status !== "connected" || voiceState.requestingMicrophone}
            aria-pressed={!voiceState.micMuted}
            title={voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
            onClick={() => onSetMicrophoneMuted(!voiceState.micMuted)}
          >
            {voiceState.micMuted ? <MicrophoneMutedIcon /> : <MicrophoneIcon />}
            {voiceState.requestingMicrophone ? "Starting..." : " " }
          </button>
          <button
            type="button"
            className={`icon-button ${deafened ? "muted" : ""}`}
            aria-pressed={deafened}
            title={deafened ? "Hear room voice" : "Deafen room voice"}
            onClick={onToggleDeafen}
          >
            {deafened ? <VolumeMutedIcon /> : <VolumeIcon />}
          </button>
        </div>
      </div>

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

      <div className="privacy-note"><i>↗</i><span><strong>Encrypted media</strong><small>Direct with relay fallback</small></span></div>
    </footer>
  );
}
