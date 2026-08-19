import { useRoom } from "../hooks/useRoom";
import { RoomHeader } from "./room/RoomHeader";
import { ErrorBanner } from "./room/ErrorBanner";
import { VideoStage } from "./room/VideoStage";
import { ControlDock } from "./room/ControlDock";

type RoomProps = {
  roomId: string;
  name: string;
};

export function Room({ roomId, name }: RoomProps) {
  const room = useRoom(roomId, name);

  return (
    <main className="room-shell">
      <RoomHeader roomId={roomId} status={room.status} />

      {room.error && (
        <ErrorBanner message={room.error} onDismiss={() => room.setError("")} />
      )}

      <VideoStage
        localStream={room.localStream}
        peers={room.peers}
        remoteStreams={room.remoteStreams}
        connectionStates={room.connectionStates}
        localName={name}
      />

      <ControlDock
        name={name}
        status={room.status}
        localStream={room.localStream}
        isStartingShare={room.isStartingShare}
        peers={room.peers}
        onStartShare={room.startSharing}
        onStopShare={room.stopSharing}
      />
    </main>
  );
}