import { useState } from "react";
import { roomFromPath } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";
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

  if (!roomId) return <Landing />;
  if (!join) return <NameGate roomId={roomId} onJoin={(name, token) => setJoin({ name, token })} />;

  const rejectSession = () => {
    clearSession(roomId);
    setJoin(null);
  };

  return (
    <Room
      roomId={roomId}
      name={join.name}
      token={join.token}
      onLeave={rejectSession}
      onSessionRejected={rejectSession}
    />
  );
}