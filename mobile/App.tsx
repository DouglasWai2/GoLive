import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { parseInviteUrl } from "@golive/core";
import type { InviteLink } from "@golive/core";
import { LandingScreen } from "./src/screens/LandingScreen";
import { NameGateScreen } from "./src/screens/NameGateScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { clearSession, loadSession } from "./src/session";

const LAST_ROOM_KEY = "golive-last-room";

type Stage =
  | { screen: "landing" }
  | { screen: "name"; roomId: string; inviteToken?: string }
  | { screen: "room"; roomId: string; name: string; token: string; inviteToken?: string };

export default function App() {
  const [stage, setStage] = useState<Stage | null>(null);

  const roomForInvite = (invite: InviteLink) => {
    void (async () => {
      const stored = await loadSession(invite.roomId);

      if (stored) {
        setStage({
          screen: "room",
          roomId: invite.roomId,
          name: stored.name,
          token: stored.token,
          inviteToken: stored.inviteToken,
        });
        return;
      }

      setStage({
        screen: "name",
        roomId: invite.roomId,
        inviteToken: invite.inviteToken,
      });
    })();
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initialUrl = await Linking.getInitialURL();
      const invite = initialUrl ? parseInviteUrl(initialUrl) : null;

      if (cancelled) return;

      if (invite) {
        roomForInvite(invite);
        return;
      }

      const roomId = await AsyncStorage.getItem(LAST_ROOM_KEY);
      const session = roomId ? await loadSession(roomId) : null;

      if (cancelled) return;

      setStage(
        session && roomId
          ? {
              screen: "room",
              roomId,
              name: session.name,
              token: session.token,
              inviteToken: session.inviteToken,
            }
          : { screen: "landing" },
      );
    })();

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const invite = parseInviteUrl(url);

      if (invite) {
        roomForInvite(invite);
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const joinRoom = (roomId: string, inviteToken?: string) => {
    setStage({ screen: "name", roomId, inviteToken });
  };

  const handleJoined = (
    roomId: string,
    name: string,
    token: string,
    inviteToken?: string,
  ) => {
    AsyncStorage.setItem(LAST_ROOM_KEY, roomId).catch(() => {});
    setStage({ screen: "room", roomId, name, token, inviteToken });
  };

  const leave = (roomId: string) => {
    clearSession(roomId).catch(() => {});
    AsyncStorage.removeItem(LAST_ROOM_KEY).catch(() => {});
    setStage({ screen: "landing" });
  };

  const rejected = (roomId: string, inviteToken?: string) => {
    clearSession(roomId).catch(() => {});
    setStage({ screen: "name", roomId, inviteToken });
  };

  if (!stage) return null;

  switch (stage.screen) {
    case "landing":
      return <LandingScreen onJoinRoom={joinRoom} />;
    case "name":
      return (
        <NameGateScreen
          roomId={stage.roomId}
          inviteToken={stage.inviteToken}
          initialName=""
          onBack={() => setStage({ screen: "landing" })}
          onJoined={(name, token) =>
            handleJoined(stage.roomId, name, token, stage.inviteToken)
          }
        />
      );
    case "room":
      return (
        <RoomScreen
          roomId={stage.roomId}
          name={stage.name}
          token={stage.token}
          onLeave={() => leave(stage.roomId)}
          onSessionRejected={() => rejected(stage.roomId, stage.inviteToken)}
          onSessionReplaced={() => leave(stage.roomId)}
        />
      );
  }
}