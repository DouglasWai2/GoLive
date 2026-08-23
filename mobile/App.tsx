import { useEffect, useState } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as ScreenOrientation from "expo-screen-orientation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { parseInviteUrl } from "@golive/core";
import type { InviteLink } from "@golive/core";
import { LandingScreen } from "./src/screens/LandingScreen";
import { NameGateScreen } from "./src/screens/NameGateScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { SessionReplacedScreen } from "./src/screens/SessionReplacedScreen";
import { Brand } from "./src/components/Brand";
import { colors } from "./src/theme";
import { clearSession, loadSession } from "./src/session";

const LAST_ROOM_KEY = "golive-last-room";
const LAST_NAME_KEY = "golive-name";

type Stage =
  | { screen: "landing" }
  | { screen: "name"; roomId: string; inviteToken?: string; initialName: string }
  | { screen: "room"; roomId: string; name: string; token: string; inviteToken?: string }
  | { screen: "replaced"; roomId: string; name: string; token: string; inviteToken?: string };

export default function App() {
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

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

      const initialName = (await AsyncStorage.getItem(LAST_NAME_KEY)) ?? "";

      setStage({
        screen: "name",
        roomId: invite.roomId,
        inviteToken: invite.inviteToken,
        initialName,
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
    void AsyncStorage.getItem(LAST_NAME_KEY).then((initialName) => {
      setStage({ screen: "name", roomId, inviteToken, initialName: initialName ?? "" });
    });
  };

  const handleJoined = (
    roomId: string,
    name: string,
    token: string,
    inviteToken?: string,
  ) => {
    AsyncStorage.setItem(LAST_ROOM_KEY, roomId).catch(() => {});
    AsyncStorage.setItem(LAST_NAME_KEY, name).catch(() => {});
    setStage({ screen: "room", roomId, name, token, inviteToken });
  };

  const leave = (roomId: string) => {
    clearSession(roomId).catch(() => {});
    AsyncStorage.removeItem(LAST_ROOM_KEY).catch(() => {});
    setStage({ screen: "landing" });
  };

  const rejected = (roomId: string, inviteToken?: string) => {
    clearSession(roomId).catch(() => {});
    void AsyncStorage.getItem(LAST_NAME_KEY).then((initialName) => {
      setStage({ screen: "name", roomId, inviteToken, initialName: initialName ?? "" });
    });
  };

  let content;

  if (!stage) {
    content = (
      <View style={styles.loading}>
        <Brand />
      </View>
    );
  } else {
    switch (stage.screen) {
      case "landing":
        content = <LandingScreen onJoinRoom={joinRoom} />;
        break;
      case "name":
        content = (
          <NameGateScreen
            roomId={stage.roomId}
            inviteToken={stage.inviteToken}
            initialName={stage.initialName}
            onBack={() => setStage({ screen: "landing" })}
            onJoined={(name, token) =>
              handleJoined(stage.roomId, name, token, stage.inviteToken)
            }
          />
        );
        break;
      case "room":
        content = (
          <RoomScreen
            roomId={stage.roomId}
            name={stage.name}
            token={stage.token}
            onLeave={() => leave(stage.roomId)}
            onSessionRejected={() => rejected(stage.roomId, stage.inviteToken)}
            onSessionReplaced={() => setStage({ ...stage, screen: "replaced" })}
          />
        );
        break;
      case "replaced":
        content = (
          <SessionReplacedScreen
            roomId={stage.roomId}
            onReconnect={() => setStage({ ...stage, screen: "room" })}
            onLeave={() => leave(stage.roomId)}
          />
        );
        break;
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      {content}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
});
