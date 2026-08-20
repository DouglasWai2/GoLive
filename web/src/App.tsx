import { useState } from "react";
import { roomFromPath } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";
import { SessionReplaced } from "./components/SessionReplaced";
import { clearSession, loadSession } from "./utils/session";

type Join = {
  name: string;
  token: string;
};

export default function App() {
  const roomId = roomFromPath();
  const [join, setJoin] = useState<Join | null>(() => {
    if (!roomId) return null;

    const stored = loadSession(roomId);

    return stored ? { name: stored.name, token: stored.token } : null;
  });
  const [replaced, setReplaced] = useState(false);

  if (!roomId) return <Landing />;

  const rejectSession = () => {
    clearSession(roomId);
    setJoin(null);
    setReplaced(false);
  };

  if (replaced && join) {
    return (
      <SessionReplaced
        roomId={roomId}
        onReconnect={() => {
          const stored = loadSession(roomId);

          if (!stored) {
            setJoin(null);
            setReplaced(false);
            return;
          }

          setReplaced(false);
        }}
      />
    );
  }

  if (!join) return <NameGate roomId={roomId} onJoin={(name, token) => setJoin({ name, token })} />;

  return (
    <Room
      roomId={roomId}
      name={join.name}
      token={join.token}
      onLeave={rejectSession}
      onSessionRejected={rejectSession}
      onSessionReplaced={() => setReplaced(true)}
    />
  );
}