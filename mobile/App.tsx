import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LandingScreen } from "./src/screens/LandingScreen";
import { NameGateScreen } from "./src/screens/NameGateScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { clearSession, loadSession } from "./src/session";

const LAST_ROOM_KEY = "golive-last-room";

type Stage =
  | { screen: "landing" }
  | { screen: "name"; roomId: string }
  | { screen: "room"; roomId: string; name: string; token: string };

export default function App() {
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const roomId = await AsyncStorage.getItem(LAST_ROOM_KEY);
      const session = roomId ? await loadSession(roomId) : null;

      if (cancelled) return;

      setStage(
        session && roomId
          ? { screen: "room", roomId, name: session.name, token: session.token }
          : { screen: "landing" },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const joinRoom = (roomId: string) => {
    setStage({ screen: "name", roomId });
  };

  const handleJoined = (roomId: string, name: string, token: string) => {
    AsyncStorage.setItem(LAST_ROOM_KEY, roomId).catch(() => {});
    setStage({ screen: "room", roomId, name, token });
  };

  const leave = (roomId: string) => {
    clearSession(roomId).catch(() => {});
    AsyncStorage.removeItem(LAST_ROOM_KEY).catch(() => {});
    setStage({ screen: "landing" });
  };

  const rejected = (roomId: string) => {
    clearSession(roomId).catch(() => {});
    setStage({ screen: "name", roomId });
  };

  if (!stage) return null;

  switch (stage.screen) {
    case "landing":
      return <LandingScreen onJoinRoom={joinRoom} />;
    case "name":
      return (
        <NameGateScreen
          roomId={stage.roomId}
          initialName=""
          onBack={() => setStage({ screen: "landing" })}
          onJoined={(name, token) => handleJoined(stage.roomId, name, token)}
        />
      );
    case "room":
      return (
        <RoomScreen
          roomId={stage.roomId}
          name={stage.name}
          token={stage.token}
          onLeave={() => leave(stage.roomId)}
          onSessionRejected={() => rejected(stage.roomId)}
          onSessionReplaced={() => leave(stage.roomId)}
        />
      );
  }
}