import { useState } from "react";
import { useRoom } from "../hooks/useRoom";
import type { ShareSettings } from "@golive/core";
import { formatBitrate, formatResolution } from "@golive/core";
import { RoomHeader } from "./room/RoomHeader";
import { ErrorBanner } from "./room/ErrorBanner";
import { VideoStage } from "./room/VideoStage";
import { ControlDock } from "./room/ControlDock";

type RoomProps = {
  roomId: string;
  name: string;
  token: string;
  onLeave: () => void;
  onSessionRejected?: () => void;
  onSessionReplaced?: () => void;
};

export function Room({
  roomId,
  name,
  token,
  onLeave,
  onSessionRejected,
  onSessionReplaced,
}: RoomProps) {
  const room = useRoom(roomId, name, token, onSessionRejected, onSessionReplaced);
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);

  const startShare = (settings: ShareSettings) => {
    setShareSettings(settings);
    room.startSharing(settings);
  };

  const stopShare = () => {
    setShareSettings(null);
    room.stopSharing();
  };

  const localQuality =
    room.localStream && shareSettings
      ? `${formatResolution(shareSettings.width, shareSettings.height)} · ${shareSettings.frameRate} fps · ${formatBitrate(shareSettings.maxBitrate)}`
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
        remoteStreams={room.remoteStreams}
        connectionStates={room.connectionStates}
        remoteStats={room.remoteStats}
        outboundStats={room.outboundStats}
        localQuality={localQuality}
        localName={name}
      />

      <ControlDock
        name={name}
        status={room.status}
        localStream={room.localStream}
        isStartingShare={room.isStartingShare}
        peers={room.peers}
        activeSettings={shareSettings}
        onStartShare={startShare}
        onStopShare={stopShare}
      />
    </main>
  );
}
