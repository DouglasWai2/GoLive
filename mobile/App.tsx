import { useEffect, useState } from "react";
import { Alert, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as ScreenOrientation from "expo-screen-orientation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DeviceRequestError, leaveRoom, parseInviteUrl, restoreRoom } from "@golive/core";
import type { InviteLink } from "@golive/core";
import { LandingScreen } from "./src/screens/LandingScreen";
import { NameGateScreen } from "./src/screens/NameGateScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { SessionReplacedScreen } from "./src/screens/SessionReplacedScreen";
import { Brand } from "./src/components/Brand";
import { SwitchRoomDialog } from "./src/components/SwitchRoomDialog";
import { colors } from "./src/theme";
import { clearDeviceToken, loadDeviceToken } from "./src/session";
import { SIGNALING_URL } from "./src/config";

const LAST_ROOM_KEY = "golive-last-room";
const LAST_NAME_KEY = "golive-name";

type Stage =
  | { screen: "landing" }
  | { screen: "error" }
  | { screen: "name"; roomId: string; inviteToken?: string; initialName: string }
  | { screen: "room"; roomId: string; name: string; token: string; inviteToken?: string }
  | { screen: "replaced"; roomId: string; name: string; token: string; inviteToken?: string };

export default function App() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [switchRequest, setSwitchRequest] = useState<{ invite: InviteLink; saved: Extract<Stage, { screen: "room" }> } | null>(null);
  const [leavingError, setLeavingError] = useState(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const restoreExisting = async (): Promise<Stage | null> => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) return null;
    try {
      const result = await restoreRoom(SIGNALING_URL, deviceToken);
      await AsyncStorage.setItem(LAST_ROOM_KEY, result.session.roomId);
      return { screen: "room", roomId: result.session.roomId, name: result.session.name, token: result.token };
    } catch (error) {
      if (error instanceof DeviceRequestError && error.status === 404) {
        await AsyncStorage.removeItem(LAST_ROOM_KEY);
        return null;
      }
      if (error instanceof DeviceRequestError && error.status === 401) {
        await clearDeviceToken();
        await AsyncStorage.removeItem(LAST_ROOM_KEY);
        return null;
      }
      throw error;
    }
  };

  const roomForInvite = async (invite: InviteLink, previous?: Stage | null) => {
    try {
      const saved = previous !== undefined ? previous : await restoreExisting();
      if (saved?.screen === "room" && saved.roomId === invite.roomId) {
        setStage(saved);
        return;
      }
      if (saved?.screen === "room") {
        setSwitchRequest({ invite, saved });
        return;
      }
      const initialName = (await AsyncStorage.getItem(LAST_NAME_KEY)) ?? "";
      setStage({ screen: "name", roomId: invite.roomId, inviteToken: invite.inviteToken, initialName });
    } catch {
      setStage({ screen: "error" });
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initialUrl = await Linking.getInitialURL();
      const invite = initialUrl ? parseInviteUrl(initialUrl) : null;

      if (cancelled) return;

      try {
        const saved = await restoreExisting();
        if (cancelled) return;
        if (invite) await roomForInvite(invite, saved);
        else setStage(saved ?? { screen: "landing" });
      } catch {
        if (!cancelled) setStage({ screen: "error" });
      }
    })();

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const invite = parseInviteUrl(url);

      if (invite) {
        void roomForInvite(invite);
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

  const leave = async () => {
    try {
      const deviceToken = await loadDeviceToken();
      if (deviceToken) await leaveRoom(SIGNALING_URL, deviceToken);
      await AsyncStorage.removeItem(LAST_ROOM_KEY);
      setStage({ screen: "landing" });
    } catch {
      Alert.alert("Could not leave", "Check your connection and try again.");
    }
  };

  const leaveWithoutConnection = async () => {
    if (leavingError) return;
    setLeavingError(true);
    try {
      const deviceToken = await loadDeviceToken();
      if (deviceToken) {
        try { await leaveRoom(SIGNALING_URL, deviceToken); } catch { /* Allow leaving while offline. */ }
      }
      await clearDeviceToken();
      await AsyncStorage.removeItem(LAST_ROOM_KEY);
      setStage({ screen: "landing" });
    } catch {
      Alert.alert("Could not leave", "Please try again.");
    } finally {
      setLeavingError(false);
    }
  };

  const stayInRoom = () => {
    if (!switchRequest) return;
    setStage(switchRequest.saved);
    setSwitchRequest(null);
  };

  const switchRooms = async () => {
    if (!switchRequest) return;
    const { invite } = switchRequest;
    setSwitchRequest(null);
    try {
      const initialName = (await AsyncStorage.getItem(LAST_NAME_KEY)) ?? "";
      setStage({ screen: "name", roomId: invite.roomId, inviteToken: invite.inviteToken, initialName });
    } catch {
      setStage({ screen: "error" });
    }
  };

  const rejected = async () => {
    try { setStage(await restoreExisting() ?? { screen: "landing" }); }
    catch { setStage({ screen: "error" }); }
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
      case "error":
        content = (
          <View style={styles.loading}>
            <Brand />
            <Text style={styles.errorText}>Could not restore your room.</Text>
            <Pressable onPress={() => {
              setStage(null);
              void restoreExisting().then((saved) => setStage(saved ?? { screen: "landing" })).catch(() => setStage({ screen: "error" }));
            }} disabled={leavingError} accessibilityRole="button">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => void leaveWithoutConnection()} disabled={leavingError} accessibilityRole="button">
              <Text style={styles.leaveText}>{leavingError ? "Leaving..." : "Leave room"}</Text>
            </Pressable>
          </View>
        );
        break;
      case "name":
        content = (
          <NameGateScreen
            roomId={stage.roomId}
            inviteToken={stage.inviteToken}
            initialName={stage.initialName}
            onBack={() => { void restoreExisting().then((saved) => setStage(saved ?? { screen: "landing" })).catch(() => setStage({ screen: "error" })); }}
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
            onLeave={() => void leave()}
            onLeaveDisconnected={() => void leaveWithoutConnection()}
            onSessionRejected={() => void rejected()}
            onSessionReplaced={() => setStage({ ...stage, screen: "replaced" })}
          />
        );
        break;
      case "replaced":
        content = (
          <SessionReplacedScreen
            roomId={stage.roomId}
            onReconnect={() => setStage({ ...stage, screen: "room" })}
            onLeave={() => void leave()}
          />
        );
        break;
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      {content}
      <SwitchRoomDialog visible={switchRequest !== null} onStay={stayInRoom} onSwitch={() => void switchRooms()} />
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
  errorText: { color: colors.paper, marginBottom: 20 },
  retryText: { color: colors.acid, fontWeight: "700" },
  leaveText: { color: colors.redText, fontWeight: "600", marginTop: 22 },
});
