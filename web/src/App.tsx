import { useEffect, useState } from "react";
import { roomFromPath, inviteTokenFromUrl, clearInviteTokenFromUrl } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";
import { SessionReplaced } from "./components/SessionReplaced";
import { Admin } from "./components/Admin";
import { clearSession, loadSession } from "./utils/session";

type Join = {
  name: string;
  token: string;
};

function RoomApp() {
  const roomId = roomFromPath();
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    if (!roomId) return null;

    return loadSession(roomId)?.inviteToken ?? inviteTokenFromUrl();
  });
  const [join, setJoin] = useState<Join | null>(() => {
    if (!roomId) return null;

    const stored = loadSession(roomId);

    return stored ? { name: stored.name, token: stored.token } : null;
  });
  const [replaced, setReplaced] = useState(false);

  useEffect(() => {
    if (join) clearInviteTokenFromUrl();
  }, [join]);

  if (!roomId) return <Landing />;

  const rejectSession = () => {
    clearSession(roomId);
    setJoin(null);
    setReplaced(false);
  };

  const handleJoin = (name: string, token: string) => {
    setJoin({ name, token });
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

  if (!join)
    return (
      <NameGate
        roomId={roomId}
        inviteToken={inviteToken}
        onJoin={handleJoin}
      />
    );

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

export default function App() {
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) {
    return <Admin />;
  }

  return <RoomApp />;
}
