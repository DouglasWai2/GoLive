import { useEffect, useState } from "react";
import { useRoom } from "../hooks/useRoom";
import type { ShareSettings } from "@golive/core";
import { formatBitrate, formatResolution } from "@golive/core";
import type { CallStageSource, VoicePlaybackSettings } from "../types";
import { RoomHeader } from "./room/RoomHeader";
import { ErrorBanner } from "./room/ErrorBanner";
import { VideoStage } from "./room/VideoStage";
import { ControlDock } from "./room/ControlDock";
import { VoiceAudio } from "./room/VoiceAudio";
import { playNotificationSound } from "../utils/notificationSounds";

const DEFAULT_VOICE_PLAYBACK_SETTINGS: VoicePlaybackSettings = { volume: 1, muted: false };

type RoomProps = {
  roomId: string;
  name: string;
  token: string;
  onLeave: () => void;
  onLeaveDisconnected: () => void;
  onSessionRejected?: () => void;
  onSessionReplaced?: () => void;
};

export function Room({
  roomId,
  name,
  token,
  onLeave,
  onLeaveDisconnected,
  onSessionRejected,
  onSessionReplaced,
}: RoomProps) {
  const room = useRoom(roomId, name, token, onSessionRejected, onSessionReplaced);
  const [displayName, setDisplayName] = useState(name);
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);
  const [deafened, setDeafened] = useState(false);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const [stoppedWatchingRemote, setStoppedWatchingRemote] = useState(false);
  const [stageSource, setStageSource] = useState<CallStageSource>("remote");
  const [voicePlaybackSettings, setVoicePlaybackSettings] = useState<Record<string, VoicePlaybackSettings>>({});

  useEffect(() => {
    const activeSharers = room.peers.filter((peer) => peer.sharing && peer.streamId);
    if (activeSharers.length === 0) {
      setFocusedPeerId(null);
      setStoppedWatchingRemote(false);
      return;
    }
    if (stoppedWatchingRemote) return;
    if (focusedPeerId && activeSharers.some((peer) => peer.id === focusedPeerId)) return;
    setFocusedPeerId(activeSharers[0].id);
  }, [focusedPeerId, room.peers, stoppedWatchingRemote]);

  useEffect(() => {
    setStageSource(room.localStream ? "local" : "remote");
  }, [room.localStream]);

  useEffect(() => {
    room.focusPeer(focusedPeerId);
  }, [focusedPeerId, room.focusPeer]);

  useEffect(() => {
    const activePeerIds = new Set(room.peers.map((peer) => peer.id));
    setVoicePlaybackSettings((current) => {
      if (!Object.keys(current).some((peerId) => !activePeerIds.has(peerId))) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([peerId]) => activePeerIds.has(peerId)),
      );
    });
  }, [room.peers]);

  useEffect(() => {
    const updateName = (event: StorageEvent) => {
      if (event.key === "golive-name" && event.newValue?.trim()) setDisplayName(event.newValue);
    };
    window.addEventListener("storage", updateName);
    return () => window.removeEventListener("storage", updateName);
  }, []);

  const startShare = (settings: ShareSettings) => {
    setShareSettings(settings);
    room.startSharing(settings);
  };

  const stopShare = () => {
    setShareSettings(null);
    room.stopSharing();
  };

  const focusPeer = (peerId: string) => {
    setStoppedWatchingRemote(false);
    setFocusedPeerId(peerId);
  };

  const stopWatchingRemote = () => {
    setStoppedWatchingRemote(true);
    setFocusedPeerId(null);
  };

  const changeVoiceVolume = (peerId: string, volume: number) => {
    setVoicePlaybackSettings((current) => {
      const previous = current[peerId] ?? DEFAULT_VOICE_PLAYBACK_SETTINGS;
      return {
        ...current,
        [peerId]: { volume, muted: volume > 0 ? false : previous.muted },
      };
    });
  };

  const togglePeerVoiceMute = (peerId: string) => {
    setVoicePlaybackSettings((current) => {
      const previous = current[peerId] ?? DEFAULT_VOICE_PLAYBACK_SETTINGS;
      return { ...current, [peerId]: { ...previous, muted: !previous.muted } };
    });
  };

  const toggleDeafen = () => {
    const nextDeafened = !deafened;
    setDeafened(nextDeafened);
    playNotificationSound(nextDeafened ? "deafen" : "undeafen");
  };

  const localQuality =
    room.localStream && shareSettings
      ? `${formatResolution(shareSettings.width, shareSettings.height)} · ${shareSettings.frameRate} fps · ${formatBitrate(shareSettings.maxBitrate)} · ${room.localStream.getAudioTracks().length > 0 ? "Audio on" : "No audio"}`
      : null;

  return (
    <main className="room-shell">
      <RoomHeader roomId={roomId} token={token} status={room.status} onLeave={onLeave} />

      {room.error && (
        <ErrorBanner message={room.error} onDismiss={() => room.setError("")} />
      )}

      <VideoStage
        localStream={room.localStream}
        peers={room.peers}
        focusedPeerId={focusedPeerId}
        onFocusPeer={focusPeer}
        onStopWatchingRemote={stopWatchingRemote}
        stageSource={stageSource}
        onStageSourceChange={setStageSource}
        remoteStreams={room.remoteStreams}
        connectionStates={room.connectionStates}
        remoteStats={room.remoteStats}
        outboundStats={room.outboundStats}
        localQuality={localQuality}
        localName={displayName}
        status={room.status}
        localMicMuted={room.voiceState.micMuted}
        deafened={deafened}
        voicePlaybackSettings={voicePlaybackSettings}
        onVoiceVolumeChange={changeVoiceVolume}
        onTogglePeerVoiceMute={togglePeerVoiceMute}
        onLeaveDisconnected={onLeaveDisconnected}
      />

      <VoiceAudio streams={room.remoteVoiceStreams} deafened={deafened} settings={voicePlaybackSettings} />

      <ControlDock
        name={displayName}
        status={room.status}
        localStream={room.localStream}
        isStartingShare={room.isStartingShare}
        activeSettings={shareSettings}
        voiceState={room.voiceState}
        deafened={deafened}
        onStartShare={startShare}
        onStopShare={stopShare}
        onSetMicrophoneMuted={(muted) => void room.setMicrophoneMuted(muted)}
        onToggleDeafen={toggleDeafen}
      />
    </main>
  );
}
