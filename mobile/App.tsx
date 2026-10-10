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
  NeonAuthTokenError,
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
import {
  getNativeAuthAccessToken,
  nativeAuthConfigured,
  restoreNativeAuthSession,
  signInWithGoogle,
  signOutNativeAuth,
  type MobileAuthUser,
} from "./src/auth";

type Stage =
  | { screen: "landing" }
  | { screen: "rooms"; rooms: DeviceRoom[] }
  | { screen: "profile"; name: string }
  | { screen: "error" }
  | { screen: "name"; roomId: string; inviteToken?: string; initialName: string }
  | { screen: "room"; roomId: string; name: string; token: string; inviteToken?: string }
  | { screen: "replaced"; roomId: string; name: string; token: string; inviteToken?: string };

type RoomStage = Extract<Stage, { screen: "room" }>;

function isInvalidDeviceCredentialError(error: unknown): boolean {
  return error instanceof Error && error.message === "Invalid device credential: 401";
}

export default function App() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [switchRequest, setSwitchRequest] = useState<{ invite: InviteLink; saved: RoomStage } | null>(null);
  const [authUser, setAuthUser] = useState<MobileAuthUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const stageRef = useRef<Stage | null>(null);
  stageRef.current = stage;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    void restoreNativeAuthSession().then((user) => {
      if (!cancelled) setAuthUser(user);
    }).finally(() => {
      if (!cancelled) setAuthReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const handleAuthSignIn = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const user = await signInWithGoogle();
      if (user) setAuthUser(user);
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "Could not sign in with Google.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAuthSignOut = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      await signOutNativeAuth();
      setAuthUser(null);
      if (stageRef.current?.screen === "rooms") void openRooms();
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleNeonAuthExpired = (caught: unknown): boolean => {
    if (!(caught instanceof NeonAuthTokenError)) return false;
    if (caught.status === 401) setAuthUser(null);
    setAuthError(caught.message);
    setStage({ screen: "landing" });
    return true;
  };

  const openRooms = async () => {
    setStage(null);
    try {
      const authToken = await getNativeAuthAccessToken();
      if (!authToken) {
        setStage({ screen: "landing" });
        return;
      }
      const deviceToken = await loadDeviceToken();
      if (!deviceToken) {
        setStage({ screen: "landing" });
        return;
      }
      const [rooms, profile] = await Promise.all([
        listDeviceRooms(SIGNALING_URL, deviceToken, authToken),
        getDeviceProfile(SIGNALING_URL, deviceToken, authToken),
      ]);
      await saveDeviceName(profile.name);
      setStage({ screen: "rooms", rooms });
    } catch (caught) {
      if (handleNeonAuthExpired(caught)) {
        return;
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
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
      const result = await restoreRoom(SIGNALING_URL, deviceToken, roomId, await getNativeAuthAccessToken() ?? undefined);
      handleJoined(roomId, result.session.name, result.token);
    } catch (caught) {
      if (handleNeonAuthExpired(caught)) {
        return;
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
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
        ? await verifyInvite(SIGNALING_URL, roomId, await loadDeviceName(), inviteToken, deviceToken, await getNativeAuthAccessToken() ?? undefined)
        : await joinRoom(SIGNALING_URL, roomId, await loadDeviceName(), deviceToken, await getNativeAuthAccessToken() ?? undefined);
      if (result.deviceToken) await saveDeviceToken(result.deviceToken);
      handleJoined(roomId, result.session.name, result.token, inviteToken);
    } catch (caught) {
      if (handleNeonAuthExpired(caught)) {
        return;
      } else if ((caught instanceof DeviceRequestError && caught.status === 401) || isInvalidDeviceCredentialError(caught)) {
        if (caught instanceof DeviceRequestError) await clearDeviceToken();
        setStage({ screen: "name", roomId, inviteToken, initialName: await loadDeviceName() });
      } else if (caught instanceof Error && caught.message.endsWith(": 409")) {
        Alert.alert(
          caught.message.includes("Guests can keep access") ? "Guest room limit" : "Room limit reached",
          caught.message.includes("Guests can keep access")
            ? "Remove access to your current room before creating another, or sign in with Google."
            : "You already have five active rooms. End one before creating another.",
        );
        void openRooms();
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
        result = await restoreRoom(SIGNALING_URL, deviceToken, invite.roomId, await getNativeAuthAccessToken() ?? undefined);
      } catch (caught) {
        if (!(caught instanceof DeviceRequestError && caught.status === 404)) throw caught;
        result = await verifyInvite(
          SIGNALING_URL, invite.roomId, await loadDeviceName(), invite.inviteToken, deviceToken,
          await getNativeAuthAccessToken() ?? undefined,
        );
      }
      if (result.deviceToken) await saveDeviceToken(result.deviceToken);
      handleJoined(invite.roomId, result.session.name, result.token, invite.inviteToken);
    } catch (caught) {
      if (handleNeonAuthExpired(caught)) {
        return;
      } else if ((caught instanceof DeviceRequestError && caught.status === 401) || isInvalidDeviceCredentialError(caught)) {
        if (caught instanceof DeviceRequestError) await clearDeviceToken();
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
      const profile = await getDeviceProfile(SIGNALING_URL, deviceToken, await getNativeAuthAccessToken() ?? undefined);
      await saveDeviceName(profile.name);
      setStage({ screen: "profile", name: profile.name });
    } catch (caught) {
      if (handleNeonAuthExpired(caught)) {
        return;
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
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
    try {
      const profile = await updateDeviceProfile(SIGNALING_URL, deviceToken, name, await getNativeAuthAccessToken() ?? undefined);
      await saveDeviceName(profile.name);
      setStage({ screen: "profile", name: profile.name });
    } catch (caught) {
      handleNeonAuthExpired(caught);
      throw caught;
    }
  };

  const removeRoom = async (room: DeviceRoom) => {
    const deviceToken = await loadDeviceToken();
    if (!deviceToken) {
      await openRooms();
      return;
    }
    try {
      await removeDeviceRoom(SIGNALING_URL, deviceToken, room.id, await getNativeAuthAccessToken() ?? undefined);
      setStage((current) => current?.screen === "rooms"
        ? { ...current, rooms: current.rooms.filter((candidate) => candidate.id !== room.id) }
        : current);
    } catch (caught) {
      if (handleNeonAuthExpired(caught)) {
        return;
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
      } else {
        Alert.alert("Could not remove room", "Check your connection and try again.");
      }
    }
  };

  const leave = () => { void openRooms(); };
  const rejected = async () => {
    const current = stageRef.current;
    if (current?.screen !== "room") {
      await openRooms();
      return;
    }

    try {
      const deviceToken = await loadDeviceToken();
      if (!deviceToken) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
        return;
      }

      setStage(null);
      const result = await restoreRoom(SIGNALING_URL, deviceToken, current.roomId);
      handleJoined(current.roomId, result.session.name, result.token);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 404) {
        await openRooms();
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
        await clearDeviceToken();
        setStage({ screen: "landing" });
      } else {
        setStage({ screen: "error" });
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (!authReady) return;
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
  }, [authReady]);

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
        content = (
          <LandingScreen
            onJoinRoom={(roomId, inviteToken) => void createOrJoinRoom(roomId, inviteToken)}
            authConfigured={nativeAuthConfigured}
            authBusy={authBusy}
            authUser={authUser}
            authError={authError}
            onSignIn={() => void handleAuthSignIn()}
            onSignOut={() => void handleAuthSignOut()}
          />
        );
        break;
      case "rooms":
        content = (
          <DeviceRoomsScreen
            rooms={stage.rooms}
            onEnter={(roomId) => void enterRoom(roomId)}
            onCreateRoom={() => void createOrJoinRoom(createRoomId())}
            onOpenProfile={() => void openProfile()}
            onRemoveRoom={(room) => void removeRoom(room)}
            authConfigured={nativeAuthConfigured}
            authBusy={authBusy}
            authUser={authUser}
            authError={authError}
            onSignIn={() => void handleAuthSignIn()}
            onSignOut={() => void handleAuthSignOut()}
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
            onAuthExpired={(error) => {
              if (error.status === 401) setAuthUser(null);
              setAuthError(error.message);
            }}
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
