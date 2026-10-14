import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { CallStageSource, Peer, VoicePlaybackSettings } from "../../types";
import { CloseIcon, EyeOffIcon, ScreenIcon, ScreenOffIcon, UsersIcon, VolumeIcon, VolumeMutedIcon } from "../icons";
import { VolumeControl } from "./VolumeControl";
import { LOCAL_SPEAKER_ID } from "../../hooks/useSpeakingPeers";

type ParticipantsPanelProps = {
  localName: string;
  localStream: MediaStream | null;
  peers: Peer[];
  focusedPeerId: string | null;
  stageSource: CallStageSource | null;
  localMicMuted: boolean;
  deafened: boolean;
  voicePlaybackSettings: Record<string, VoicePlaybackSettings>;
  screenVolume: number;
  screenMuted: boolean;
  screenHasAudio: boolean;
  speakingPeerIds: Set<string>;
  onFocusPeer: (peerId: string) => void;
  onStageSourceChange: (source: CallStageSource) => void;
  onVoiceVolumeChange: (peerId: string, volume: number) => void;
  onTogglePeerVoiceMute: (peerId: string) => void;
  onScreenVolumeChange: (volume: number) => void;
  onToggleScreenMute: () => void;
  onStopWatchingRemote: () => void;
};

export type ParticipantsPanelHandle = { open: () => void };

const DEFAULT_VOICE_SETTINGS: VoicePlaybackSettings = { volume: 1, muted: false };

export const ParticipantsPanel = forwardRef<ParticipantsPanelHandle, ParticipantsPanelProps>(function ParticipantsPanel({
  localName,
  localStream,
  peers,
  focusedPeerId,
  stageSource,
  localMicMuted,
  deafened,
  voicePlaybackSettings,
  screenVolume,
  screenMuted,
  screenHasAudio,
  speakingPeerIds,
  onFocusPeer,
  onStageSourceChange,
  onVoiceVolumeChange,
  onTogglePeerVoiceMute,
  onScreenVolumeChange,
  onToggleScreenMute,
  onStopWatchingRemote,
}: ParticipantsPanelProps, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const sharingCount = peers.filter((peer) => peer.sharing && peer.streamId).length + Number(Boolean(localStream));

  const close = () => dialogRef.current?.close();
  const openDialog = () => {
    if (dialogRef.current?.open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    dialogRef.current?.showModal();
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: openDialog }));
  const selectRemote = (peerId: string) => {
    onFocusPeer(peerId);
    close();
  };
  const selectLocal = () => {
    onStageSourceChange("local");
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="people-count"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`People in the call: ${peers.length + 1}`}
        title="People in the call"
        onClick={openDialog}
      >
        <UsersIcon /> <strong>{peers.length + 1}</strong>
      </button>
      <dialog
        ref={dialogRef}
        className="participants-dialog"
        aria-labelledby="participants-title"
        onClose={() => {
          setOpen(false);
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
          else triggerRef.current?.focus();
        }}
      >
        <div className="participants-dialog-heading">
          <div>
            <h2 id="participants-title">People</h2>
            <p>{peers.length + 1} here · {sharingCount} live{deafened ? " · Deafened" : ""}</p>
          </div>
          <button type="button" className="participants-close" onClick={close} title="Close people" aria-label="Close people"><CloseIcon /></button>
        </div>
        <ul className="participant-list">
          <li className="participant-card">
            {localStream ? (
              <button type="button" className={`participant-select ${stageSource === "local" ? "is-on-stage" : ""} ${!localMicMuted && speakingPeerIds.has(LOCAL_SPEAKER_ID) ? "is-speaking" : ""}`} onClick={selectLocal} title="Show your screen on stage" aria-label="Show your screen on stage" aria-pressed={stageSource === "local"}>
                <span className="participant-avatar" aria-hidden="true">{localName.slice(0, 1).toUpperCase()}</span>
                <span className="participant-name"><strong>{localName} (you)</strong><small>{localMicMuted ? "Mic muted" : "Mic on"}</small></span>
                <span className="participant-share-status is-sharing" aria-label={stageSource === "local" ? "Your screen on stage" : "Sharing your screen"}><ScreenIcon size={18} /><span>{stageSource === "local" ? "ON STAGE" : "SHARING"}</span></span>
              </button>
            ) : (
              <div className={`participant-select ${!localMicMuted && speakingPeerIds.has(LOCAL_SPEAKER_ID) ? "is-speaking" : ""}`} role="group" aria-label={`${localName}, not sharing a screen`}>
                <span className="participant-avatar" aria-hidden="true">{localName.slice(0, 1).toUpperCase()}</span>
                <span className="participant-name"><strong>{localName} (you)</strong><small>{localMicMuted ? "Mic muted" : "Mic on"}</small></span>
                <span className="participant-share-status" title="Not sharing" role="img" aria-label="Not sharing"><ScreenOffIcon size={18} /></span>
              </div>
            )}
          </li>
          {peers.map((peer) => {
            const settings = voicePlaybackSettings[peer.id] ?? DEFAULT_VOICE_SETTINGS;
            const isSharing = peer.sharing && Boolean(peer.streamId);
            const isWatched = peer.id === focusedPeerId;
            const isOnStage = isWatched && stageSource === "remote";
            const watchedLocation = stageSource === "local" ? "IN PREVIEW" : "IN GRID";
            return (
              <li className="participant-card" key={peer.id}>
                {isSharing ? (
                  <button type="button" className={`participant-select ${isOnStage ? "is-on-stage" : isWatched ? "is-in-preview" : ""} ${!peer.micMuted && speakingPeerIds.has(peer.id) ? "is-speaking" : ""}`} onClick={() => selectRemote(peer.id)} title={`Watch ${peer.name}'s screen on stage`} aria-label={`Watch ${peer.name}'s screen on stage`} aria-pressed={isOnStage}>
                    <span className="participant-avatar" aria-hidden="true">{peer.name.slice(0, 1).toUpperCase()}</span>
                    <span className="participant-name"><strong>{peer.name}</strong><small>{peer.voiceJoined ? peer.micMuted ? "Mic muted" : "Mic on" : "No voice"}</small></span>
                    <span className="participant-share-status is-sharing" aria-label={isOnStage ? "Watching on stage" : isWatched ? `Watching ${stageSource === "local" ? "in preview" : "in grid"}` : "Sharing screen"}><ScreenIcon size={18} /><span>{isOnStage ? "WATCHING" : isWatched ? watchedLocation : "SHARING"}</span></span>
                  </button>
                ) : (
                  <div className={`participant-select ${!peer.micMuted && speakingPeerIds.has(peer.id) ? "is-speaking" : ""}`} role="group" aria-label={`${peer.name}, ${peer.sharing ? "starting a screen share" : "not sharing a screen"}`}>
                    <span className="participant-avatar" aria-hidden="true">{peer.name.slice(0, 1).toUpperCase()}</span>
                    <span className="participant-name"><strong>{peer.name}</strong><small>{peer.voiceJoined ? peer.micMuted ? "Mic muted" : "Mic on" : "No voice"}</small></span>
                    <span className="participant-share-status" title={peer.sharing ? "Starting screen share" : "Not sharing"} role="img" aria-label={peer.sharing ? "Starting screen share" : "Not sharing"}><ScreenOffIcon size={18} /></span>
                  </div>
                )}
                {peer.voiceJoined && (
                  <details className="participant-voice">
                    <summary aria-label={`${peer.name}'s voice settings`} title={`${peer.name}'s voice volume`}>
                      {settings.muted ? <VolumeMutedIcon size={17} /> : <VolumeIcon size={17} />}
                      <span>Voice</span>
                    </summary>
                    <VolumeControl
                      className="participant-volume-control"
                      volume={settings.volume}
                      muted={settings.muted}
                      volumeLabel={`${peer.name}'s voice volume`}
                      muteLabel={`Mute ${peer.name}'s voice`}
                      unmuteLabel={`Unmute ${peer.name}'s voice`}
                      disabledLabel={`${peer.name} has no voice audio`}
                      onVolumeChange={(volume) => onVoiceVolumeChange(peer.id, volume)}
                      onToggleMute={() => onTogglePeerVoiceMute(peer.id)}
                    />
                  </details>
                )}
                {isWatched && stageSource === null && (
                  <div className="participant-screen-audio">
                    <span>Screen audio</span>
                    <VolumeControl
                      volume={screenVolume}
                      muted={screenMuted}
                      disabled={!screenHasAudio}
                      volumeLabel={`${peer.name}'s shared screen volume`}
                      muteLabel={`Mute ${peer.name}'s shared screen`}
                      unmuteLabel={`Unmute ${peer.name}'s shared screen`}
                      onVolumeChange={onScreenVolumeChange}
                      onToggleMute={onToggleScreenMute}
                    />
                  </div>
                )}
                {isWatched && !isOnStage && (
                  <button type="button" className="participant-stop-watching" onClick={() => { onStopWatchingRemote(); close(); }} title={`Stop watching ${peer.name}'s screen`} aria-label={`Stop watching ${peer.name}'s screen`}><EyeOffIcon size={18} /> Stop watching</button>
                )}
              </li>
            );
          })}
        </ul>
      </dialog>
    </>
  );
});
