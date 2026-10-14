import { useState } from "react";
import {
  MicrophoneIcon,
  MicrophoneMutedIcon,
  PhoneOffIcon,
  ScreenIcon,
  ScreenOffIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from "../icons";
import type { ShareSettings, SocketStatus, VoiceState } from "../../types";
import { ShareSettingsPanel } from "./ShareSettingsPanel";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: MediaStream | null;
  isStartingShare: boolean;
  voiceState: VoiceState;
  deafened: boolean;
  onStartShare: (settings: ShareSettings) => void;
  onStopShare: () => void;
  onSetMicrophoneMuted: (muted: boolean) => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
};

export function ControlDock({
  name,
  status,
  localStream,
  isStartingShare,
  voiceState,
  deafened,
  onStartShare,
  onStopShare,
  onSetMicrophoneMuted,
  onToggleDeafen,
  onLeave,
}: ControlDockProps) {
  const [showSettings, setShowSettings] = useState(false);

  const canShare = status === "connected" && !localStream && !isStartingShare;

  const startShare = (settings: ShareSettings) => {
    setShowSettings(false);
    onStartShare(settings);
  };

  return (
    <footer className="control-dock">
      <div className="you-chip"><span>{name.slice(0, 1).toUpperCase()}</span><div><small>YOU</small><strong>{name}</strong></div></div>
      <div className="dock-actions" role="group" aria-label="Call controls">
        <button
          type="button"
          className={`icon-button dock-button ${voiceState.micMuted ? "muted" : "active"}`}
          disabled={status !== "connected" || voiceState.requestingMicrophone}
          aria-pressed={!voiceState.micMuted}
          title={voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
          aria-label={voiceState.requestingMicrophone ? "Starting microphone" : voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
          onClick={() => onSetMicrophoneMuted(!voiceState.micMuted)}
        >
          {voiceState.micMuted ? <MicrophoneMutedIcon /> : <MicrophoneIcon />}
        </button>
        <button
          type="button"
          className={`icon-button dock-button ${deafened ? "muted" : ""}`}
          aria-pressed={deafened}
          title={deafened ? "Hear room voice" : "Deafen room voice"}
          aria-label={deafened ? "Hear room voice" : "Deafen room voice"}
          onClick={onToggleDeafen}
        >
          {deafened ? <VolumeMutedIcon /> : <VolumeIcon />}
        </button>
        <div className="share-control">
          {showSettings && !localStream && <ShareSettingsPanel
            isStarting={isStartingShare}
            onStart={startShare}
            onCancel={() => setShowSettings(false)}
          />}
          {localStream ? (
            <button type="button" className="icon-button dock-button stop-share-button" onClick={onStopShare} title="Stop sharing your screen" aria-label="Stop sharing your screen"><ScreenOffIcon /></button>
          ) : (
            <button
              type="button"
              className={`icon-button dock-button start-share-button ${showSettings ? "active" : ""}`}
              onClick={() => setShowSettings((current) => !current)}
              disabled={!canShare && !showSettings}
              title={showSettings ? "Close sharing settings" : isStartingShare ? "Choosing a screen" : "Share screen"}
              aria-label={showSettings ? "Close sharing settings" : isStartingShare ? "Choosing a screen" : "Share screen"}
              aria-expanded={showSettings}
            >
              <ScreenIcon />
            </button>
          )}
        </div>
      </div>
      <button type="button" className="dock-leave" onClick={onLeave} title="Leave room" aria-label="Leave room"><PhoneOffIcon size={22} /></button>
    </footer>
  );
}
