import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import * as ScreenOrientation from "expo-screen-orientation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  DeviceRequestError,
  getDeviceProfile,
  joinRoom,
  listDeviceRooms,
  parseInviteUrl,
  removeDeviceRoom,
  restoreRoom,
  updateDeviceProfile,
  verifyInvite,
} from "@golive/core";
import type { DeviceRoom, InviteLink } from "@golive/core";
import { LandingScreen } from "./src/screens/LandingScreen";
import { NameGateScreen } from "./src/screens/NameGateScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { SessionReplacedScreen } from "./src/screens/SessionReplacedScreen";
import { DeviceRoomsScreen } from "./src/screens/DeviceRoomsScreen";
import { DeviceProfileScreen } from "./src/screens/DeviceProfileScreen";
import { SwitchRoomDialog } from "./src/components/SwitchRoomDialog";
import { Brand } from "./src/components/Brand";
import { colors } from "./src/theme";
import { clearDeviceToken, loadDeviceName, loadDeviceToken, saveDeviceName, saveDeviceToken } from "./src/session";
import { SIGNALING_URL } from "./src/config";
import { createRoomId } from "./src/utils/roomId";

type Stage =
  | { screen: "landing" }
  | { screen: "rooms"; rooms: DeviceRoom[] }
  | { screen: "profile"; name: string }
  | { screen: "error" }
  | { screen: "name"; roomId: string; inviteToken?: string; initialName: string }
  | { screen: "room"; roomId: string; name: string; token: string; inviteToken?: string }
  | { screen: "replaced"; roomId: string; name: string; token: string; inviteToken?: string };

type RoomStage = Extract<Stage, { screen: "room" }>;

export default function App() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [switchRequest, setSwitchRequest] = useState<{ invite: InviteLink; saved: RoomStage } | null>(null);
  const stageRef = useRef<Stage | null>(null);
  stageRef.current = stage;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const openRooms = async () => {
    setStage(null);
    try {
      const deviceToken = await loadDeviceToken();
      if (!deviceToken) {
        setStage({ screen: "landing" });
        return;
      }
      const [rooms, profile] = await Promise.all([
        listDeviceRooms(SIGNALING_URL, deviceToken),
        getDeviceProfile(SIGNALING_URL, deviceToken),
      ]);
      await saveDeviceName(profile.name);
      setStage({ screen: "rooms", rooms });
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
      } else {
        setStage({ screen: "error" });
      }
    }
  };

  const handleJoined = (roomId: string, name: string, token: string, inviteToken?: string) => {
    void saveDeviceName(name).catch(() => {});
    setStage({ screen: "room", roomId, name, token, inviteToken });
  };

  const enterRoom = async (roomId: string) => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) {
      setStage({ screen: "name", roomId, initialName: await loadDeviceName() });
      return;
    }
    setStage(null);
    try {
      const result = await restoreRoom(SIGNALING_URL, deviceToken, roomId);
      handleJoined(roomId, result.session.name, result.token);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
      } else if (caught instanceof DeviceRequestError && caught.status === 404) {
        await openRooms();
      } else {
        setStage({ screen: "error" });
      }
    }
  };

  const createOrJoinRoom = async (roomId: string, inviteToken?: string) => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) {
      setStage({ screen: "name", roomId, inviteToken, initialName: await loadDeviceName() });
      return;
    }
    setStage(null);
    try {
      const result = inviteToken
        ? await verifyInvite(SIGNALING_URL, roomId, undefined, inviteToken, deviceToken)
        : await joinRoom(SIGNALING_URL, roomId, undefined, deviceToken);
      if (result.deviceToken) await saveDeviceToken(result.deviceToken);
      handleJoined(roomId, result.session.name, result.token, inviteToken);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "name", roomId, inviteToken, initialName: await loadDeviceName() });
      } else {
        setStage({ screen: "error" });
      }
    }
  };

  const enterInvite = async (invite: InviteLink, skipRoomSwitchPrompt = false) => {
    const current = stageRef.current;
    if (!skipRoomSwitchPrompt && current?.screen === "room" && current.roomId !== invite.roomId) {
      setSwitchRequest({ invite, saved: current });
      return;
    }

    const deviceToken = await loadDeviceToken();
    if (!deviceToken) {
      setStage({ screen: "name", roomId: invite.roomId, inviteToken: invite.inviteToken, initialName: await loadDeviceName() });
      return;
    }

    setStage(null);
    try {
      let result;
      try {
        result = await restoreRoom(SIGNALING_URL, deviceToken, invite.roomId);
      } catch (caught) {
        if (!(caught instanceof DeviceRequestError && caught.status === 404)) throw caught;
        result = await verifyInvite(SIGNALING_URL, invite.roomId, undefined, invite.inviteToken, deviceToken);
      }
      if (result.deviceToken) await saveDeviceToken(result.deviceToken);
      handleJoined(invite.roomId, result.session.name, result.token, invite.inviteToken);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "name", roomId: invite.roomId, inviteToken: invite.inviteToken, initialName: await loadDeviceName() });
      } else {
        setStage({ screen: "error" });
      }
    }
  };

  const openProfile = async () => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) {
      setStage({ screen: "landing" });
      return;
    }
    setStage(null);
    try {
      const profile = await getDeviceProfile(SIGNALING_URL, deviceToken);
      await saveDeviceName(profile.name);
      setStage({ screen: "profile", name: profile.name });
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
      } else {
        setStage({ screen: "error" });
      }
    }
  };

  const saveProfile = async (name: string) => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) throw new Error("Device profile is unavailable");
    const profile = await updateDeviceProfile(SIGNALING_URL, deviceToken, name);
    await saveDeviceName(profile.name);
    setStage({ screen: "profile", name: profile.name });
  };

  const removeRoom = async (room: DeviceRoom) => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) {
      await openRooms();
      return;
    }
    try {
      await removeDeviceRoom(SIGNALING_URL, deviceToken, room.id);
      setStage((current) => current?.screen === "rooms"
        ? { ...current, rooms: current.rooms.filter((candidate) => candidate.id !== room.id) }
        : current);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
      } else {
        Alert.alert("Could not remove room", "Check your connection and try again.");
      }
    }
  };

  const leave = () => { void openRooms(); };
  const rejected = () => { void openRooms(); };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const initialUrl = await Linking.getInitialURL();
      const invite = initialUrl ? parseInviteUrl(initialUrl) : null;
      if (cancelled) return;
      if (invite) {
        await enterInvite(invite);
        return;
      }
      const deviceToken = await loadDeviceToken();
      if (cancelled) return;
      if (deviceToken) await openRooms();
      else setStage({ screen: "landing" });
    };

    void initialize().catch(() => {
      if (!cancelled) setStage({ screen: "error" });
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const invite = parseInviteUrl(url);
      if (invite) void enterInvite(invite);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

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
        content = <LandingScreen onJoinRoom={(roomId, inviteToken) => void createOrJoinRoom(roomId, inviteToken)} />;
        break;
      case "rooms":
        content = (
          <DeviceRoomsScreen
            rooms={stage.rooms}
            onEnter={(roomId) => void enterRoom(roomId)}
            onCreateRoom={() => void createOrJoinRoom(createRoomId())}
            onOpenProfile={() => void openProfile()}
            onRemoveRoom={(room) => void removeRoom(room)}
          />
        );
        break;
      case "profile":
        content = <DeviceProfileScreen initialName={stage.name} onBack={() => void openRooms()} onSave={saveProfile} />;
        break;
      case "error":
        content = (
          <View style={styles.loading}>
            <Brand />
            <Text style={styles.errorText}>Could not load your rooms.</Text>
            <Pressable onPress={() => void openRooms()} accessibilityRole="button">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => setStage({ screen: "landing" })} accessibilityRole="button">
              <Text style={styles.leaveText}>Back to GoLive</Text>
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
            onBack={() => void openRooms()}
            onJoined={(name, token) => handleJoined(stage.roomId, name, token, stage.inviteToken)}
          />
        );
        break;
      case "room":
        content = (
          <RoomScreen
            roomId={stage.roomId}
            name={stage.name}
            token={stage.token}
            onLeave={leave}
            onLeaveDisconnected={leave}
            onSessionRejected={rejected}
            onSessionReplaced={() => setStage({ ...stage, screen: "replaced" })}
          />
        );
        break;
      case "replaced":
        content = (
          <SessionReplacedScreen
            roomId={stage.roomId}
            onReconnect={() => setStage({ ...stage, screen: "room" })}
            onLeave={leave}
          />
        );
        break;
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      {content}
      <SwitchRoomDialog
        visible={switchRequest !== null}
        onStay={() => {
          if (switchRequest) setStage(switchRequest.saved);
          setSwitchRequest(null);
        }}
        onSwitch={() => {
          if (switchRequest) void enterInvite(switchRequest.invite, true);
          setSwitchRequest(null);
        }}
      />
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
  leaveText: { color: colors.muted, fontWeight: "600", marginTop: 22 },
});
