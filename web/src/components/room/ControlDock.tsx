import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  MicrophoneIcon,
  MicrophoneMutedIcon,
  PhoneOffIcon,
  ScreenIcon,
  ScreenOffIcon,
  UsersIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from "../icons";
import type { ShareSettings, SocketStatus, VoiceState } from "../../types";
import { ShareSettingsPanel } from "./ShareSettingsPanel";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { useMicrophoneAudio } from "../../hooks/useMicrophoneAudio";
import { prepareMicrophoneAudioContext } from "../../audio/microphoneAudio";

type ControlDockProps = {
  name: string;
  participantsCount: number;
  participantsOpen: boolean;
  onOpenParticipants: (returnFocusTo: HTMLElement) => void;
  status: SocketStatus;
  localStream: MediaStream | null;
  isStartingShare: boolean;
  voiceState: VoiceState;
  deafened: boolean;
  globalVoiceVolume: number;
  onGlobalVoiceVolumeChange: (volume: number) => void;
  onStartShare: (settings: ShareSettings) => void;
  onStopShare: () => void;
  onSetMicrophoneMuted: (muted: boolean) => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
};

export function ControlDock({
  name,
  participantsCount,
  participantsOpen,
  onOpenParticipants,
  status,
  localStream,
  isStartingShare,
  voiceState,
  deafened,
  globalVoiceVolume,
  onGlobalVoiceVolumeChange,
  onStartShare,
  onStopShare,
  onSetMicrophoneMuted,
  onToggleDeafen,
  onLeave,
}: ControlDockProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showMicrophoneSettings, setShowMicrophoneSettings] = useState(false);
  const [showVoiceVolume, setShowVoiceVolume] = useState(false);
  const microphoneControlRef = useRef<HTMLDivElement>(null);
  const microphoneSettingsToggleRef = useRef<HTMLButtonElement>(null);
  const voiceVolumeControlRef = useRef<HTMLDivElement>(null);
  const voiceVolumeToggleRef = useRef<HTMLButtonElement>(null);
  const microphoneAudio = useMicrophoneAudio();

  const canShare = status === "connected" && !localStream && !isStartingShare;
  const microphoneTestRunning = microphoneAudio.testState === "starting"
    || microphoneAudio.testState === "active"
    || microphoneAudio.testState === "cancelling";

  useEffect(() => {
    if (!showMicrophoneSettings) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!microphoneControlRef.current?.contains(event.target as Node)) {
        setShowMicrophoneSettings(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !microphoneControlRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setShowMicrophoneSettings(false);
      microphoneSettingsToggleRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showMicrophoneSettings]);

  useEffect(() => {
    if (!showVoiceVolume) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!voiceVolumeControlRef.current?.contains(event.target as Node)) {
        setShowVoiceVolume(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !voiceVolumeControlRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setShowVoiceVolume(false);
      voiceVolumeToggleRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showVoiceVolume]);

  useEffect(() => {
    if (!showMicrophoneSettings && microphoneTestRunning) microphoneAudio.stopTest();
  }, [microphoneAudio.stopTest, microphoneTestRunning, showMicrophoneSettings]);

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
          className="icon-button dock-button dock-people-button"
          aria-haspopup="dialog"
          aria-expanded={participantsOpen}
          aria-controls="participants-dialog"
          aria-label={`Show people in the call, ${participantsCount} ${participantsCount === 1 ? "participant" : "participants"}`}
          title="Show people in the call"
          onClick={(event) => onOpenParticipants(event.currentTarget)}
        >
          <UsersIcon />
          <strong aria-hidden="true">{participantsCount}</strong>
        </button>
        <div className="microphone-control" ref={microphoneControlRef}>
          <div className="microphone-control-buttons">
            <button
              type="button"
              className={`icon-button dock-button microphone-main-button ${voiceState.micMuted ? "muted" : "active"}`}
              disabled={status !== "connected" || voiceState.requestingMicrophone || microphoneTestRunning}
              aria-pressed={!voiceState.micMuted}
              title={voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
              aria-label={voiceState.requestingMicrophone ? "Starting microphone" : voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
              onClick={() => {
                setShowMicrophoneSettings(false);
                if (voiceState.micMuted) prepareMicrophoneAudioContext();
                onSetMicrophoneMuted(!voiceState.micMuted);
              }}
            >
              {voiceState.micMuted ? <MicrophoneMutedIcon /> : <MicrophoneIcon />}
            </button>
            <button
              ref={microphoneSettingsToggleRef}
              type="button"
              className={`icon-button dock-button microphone-settings-toggle ${showMicrophoneSettings ? "active" : ""}`}
              aria-label={showMicrophoneSettings ? "Close microphone settings" : "Open microphone settings"}
              aria-controls="microphone-settings-panel"
              aria-expanded={showMicrophoneSettings}
              title="Microphone settings"
              onClick={() => {
                setShowVoiceVolume(false);
                setShowMicrophoneSettings((current) => !current);
              }}
            >
              <ChevronDownIcon expanded={showMicrophoneSettings} />
            </button>
          </div>
          {showMicrophoneSettings && (
            <MicrophoneSettings
              id="microphone-settings-panel"
              settings={microphoneAudio.settings}
              onChange={microphoneAudio.updateSettings}
              micMuted={voiceState.micMuted}
              testState={microphoneAudio.testState}
              testError={microphoneAudio.testError}
              processingSupported={microphoneAudio.processingSupported}
              onStartTest={() => void microphoneAudio.startTest()}
              onStopTest={microphoneAudio.stopTest}
            />
          )}
        </div>
        <div className="voice-volume-control" ref={voiceVolumeControlRef}>
          <div className="voice-volume-buttons">
            <button
              type="button"
              className={`icon-button dock-button voice-deafen-button ${deafened ? "muted" : ""}`}
              aria-pressed={deafened}
              title={deafened ? "Hear room voice" : "Deafen room voice"}
              aria-label={deafened ? "Hear room voice" : "Deafen room voice"}
              onClick={onToggleDeafen}
            >
              {deafened ? <VolumeMutedIcon /> : <VolumeIcon />}
            </button>
            <button
              ref={voiceVolumeToggleRef}
              type="button"
              className={`icon-button dock-button voice-volume-toggle ${showVoiceVolume ? "active" : ""}`}
              aria-label={showVoiceVolume ? "Close room voice volume" : "Open room voice volume"}
              aria-controls="room-voice-volume-panel"
              aria-expanded={showVoiceVolume}
              title="Room voice volume"
              onClick={() => {
                setShowMicrophoneSettings(false);
                setShowVoiceVolume((current) => !current);
              }}
            >
              <ChevronDownIcon expanded={showVoiceVolume} />
            </button>
          </div>
          {showVoiceVolume && (
            <div className="voice-volume-panel" id="room-voice-volume-panel" role="group" aria-labelledby="room-voice-volume-label">
              <div className="voice-volume-heading">
                <label id="room-voice-volume-label" htmlFor="room-voice-volume">Room voice volume</label>
                <output htmlFor="room-voice-volume">{Math.round(globalVoiceVolume * 100)}%</output>
              </div>
              <input
                id="room-voice-volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={globalVoiceVolume}
                onChange={(event) => onGlobalVoiceVolumeChange(Number(event.currentTarget.value))}
                aria-valuetext={`${Math.round(globalVoiceVolume * 100)} percent`}
                style={{ backgroundImage: `linear-gradient(to right, var(--acid) ${globalVoiceVolume * 100}%, #45453f ${globalVoiceVolume * 100}%)` }}
              />
            </div>
          )}
        </div>
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
