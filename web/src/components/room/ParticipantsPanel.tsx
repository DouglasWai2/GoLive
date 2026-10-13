import { useEffect, useRef, useState } from "react";
import type { Peer, VoicePlaybackSettings } from "../../types";
import { UsersIcon } from "../icons";
import { VolumeControl } from "./VolumeControl";

type ParticipantsPanelProps = {
  localName: string;
  peers: Peer[];
  localMicMuted: boolean;
  deafened: boolean;
  voicePlaybackSettings: Record<string, VoicePlaybackSettings>;
  onVoiceVolumeChange: (peerId: string, volume: number) => void;
  onTogglePeerVoiceMute: (peerId: string) => void;
};

const DEFAULT_VOICE_SETTINGS: VoicePlaybackSettings = { volume: 1, muted: false };

export function ParticipantsPanel({
  localName,
  peers,
  localMicMuted,
  deafened,
  voicePlaybackSettings,
  onVoiceVolumeChange,
  onTogglePeerVoiceMute,
}: ParticipantsPanelProps) {
  const [showParticipants, setShowParticipants] = useState(false);
  const participantsRef = useRef<HTMLDivElement>(null);
  const participantsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showParticipants) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !participantsRef.current?.contains(event.target)) {
        setShowParticipants(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setShowParticipants(false);
      participantsButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showParticipants]);

  return (
    <div className="participants" ref={participantsRef}>
      <button
        ref={participantsButtonRef}
        type="button"
        className="people-count"
        aria-expanded={showParticipants}
        aria-controls="participants-list"
        onClick={() => setShowParticipants((current) => !current)}
      >
        <UsersIcon />
        <strong>{peers.length + 1}</strong>
        <span className="people-count-label">in room</span>
      </button>
      {showParticipants && (
        <div id="participants-list" className="participants-popover" role="region" aria-label="Participants in room">
          <div className="participants-heading">
            <strong>Participants</strong>
            <span>{peers.length + 1}</span>
          </div>
          <ul>
            <li className="participant-row">
              <span className="participant-avatar" aria-hidden="true">{localName.slice(0, 1).toUpperCase()}</span>
              <span className="participant-name">
                <strong>{localName}</strong>
                <small>You · {localMicMuted ? "Muted" : "Mic on"}{deafened ? " · Deafened" : ""}</small>
              </span>
            </li>
            {peers.map((peer) => {
              const settings = voicePlaybackSettings[peer.id] ?? DEFAULT_VOICE_SETTINGS;

              return (
                <li className="participant-row" key={peer.id}>
                  <span className="participant-avatar" aria-hidden="true">{peer.name.slice(0, 1).toUpperCase()}</span>
                  <span className="participant-name">
                    <strong>{peer.name}</strong>
                    <small>{peer.voiceJoined ? peer.micMuted ? "Muted" : "Mic on" : "No voice"}</small>
                  </span>
                  {peer.voiceJoined && (
                    <VolumeControl
                      className="participant-volume-control"
                      volume={settings.volume}
                      muted={settings.muted}
                      volumeLabel={`${peer.name}'s voice volume`}
                      muteLabel={`Mute ${peer.name}`}
                      unmuteLabel={`Unmute ${peer.name}`}
                      disabledLabel={`${peer.name} has no voice audio`}
                      onVolumeChange={(volume) => onVoiceVolumeChange(peer.id, volume)}
                      onToggleMute={() => onTogglePeerVoiceMute(peer.id)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
