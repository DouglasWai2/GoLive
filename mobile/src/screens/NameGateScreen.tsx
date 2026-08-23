import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { joinRoom, verifyInvite } from "@golive/core";
import { Brand } from "../components/Brand";
import { BackIcon } from "../components/icons";
import { SIGNALING_URL } from "../config";
import { saveSession } from "../session";
import { colors, radii, raisedSurface, technicalText } from "../theme";

type NameGateScreenProps = {
  roomId: string;
  inviteToken?: string;
  initialName: string;
  onBack: () => void;
  onJoined: (name: string, token: string) => void;
};

export function NameGateScreen({
  roomId,
  inviteToken,
  initialName,
  onBack,
  onJoined,
}: NameGateScreenProps) {
  const [name, setName] = useState(initialName);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");
  const canJoin = Boolean(name.trim()) && !isJoining;

  const join = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 32 || isJoining) return;

    setIsJoining(true);
    setError("");

    try {
      const { token } = inviteToken
        ? await verifyInvite(SIGNALING_URL, roomId, trimmed, inviteToken)
        : await joinRoom(SIGNALING_URL, roomId, trimmed);

      await saveSession(roomId, trimmed, token, inviteToken);
      onJoined(trimmed, token);
    } catch (caught) {
      if (caught instanceof TypeError) {
        setError("Could not reach GoLive. Check your connection and try again.");
      } else if (
        inviteToken &&
        caught instanceof Error &&
        caught.message.toLowerCase().includes("invite")
      ) {
        setError("This invite is invalid or has expired.");
      } else if (caught instanceof Error && caught.message.endsWith(": 403")) {
        setError("This room requires an invite link to join.");
      } else {
        setError("Could not enter the room. Try again in a moment.");
      }
      setIsJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Brand compact />
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            onPress={onBack}
            disabled={isJoining}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <BackIcon color={colors.muted} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.eyebrow}>
              <View style={styles.acidDot} />
              <Text style={styles.eyebrowText} numberOfLines={1}>Room {roomId}</Text>
            </View>
            <Text style={styles.title}>How should people see you?</Text>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (error) setError("");
              }}
              placeholder="Your name"
              placeholderTextColor={colors.dim}
              maxLength={32}
              autoCorrect={false}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={() => void join()}
              accessibilityLabel="Display name"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                !canJoin && styles.buttonDisabled,
                pressed && canJoin && styles.pressed,
              ]}
              disabled={!canJoin}
              onPress={() => void join()}
              accessibilityRole="button"
            >
              {isJoining ? (
                <ActivityIndicator color={colors.acidInk} />
              ) : (
                <>
                  <Text style={styles.primaryText}>Enter the room</Text>
                  <Text style={styles.arrow}>→</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.privacy}>Your camera and microphone stay off.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  header: {
    minHeight: 68,
    marginHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4 },
  backText: { color: colors.muted, fontSize: 12 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 22, paddingBottom: 40 },
  card: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#161614",
    padding: 28,
    ...raisedSurface,
  },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 20 },
  acidDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.acid,
    shadowColor: colors.acid,
    shadowOpacity: 0.55,
    shadowRadius: 6,
  },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 10, flexShrink: 1 },
  title: { color: colors.paper, fontSize: 31, lineHeight: 35, fontWeight: "800", letterSpacing: -1.45, marginBottom: 31 },
  label: { color: "#9c9c93", fontSize: 12, marginBottom: 9 },
  input: {
    minHeight: 51,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 0,
    paddingHorizontal: 16,
    color: colors.paper,
    fontSize: 15,
  },
  error: { color: "#ff6b5e", fontSize: 13, marginTop: 10 },
  primaryButton: {
    minHeight: 49,
    marginTop: 15,
    borderRadius: radii.control,
    backgroundColor: colors.acid,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  buttonDisabled: { opacity: 0.42 },
  primaryText: { color: colors.acidInk, fontSize: 15, fontWeight: "800" },
  arrow: { color: colors.acidInk, fontSize: 18 },
  privacy: { color: colors.dim, fontSize: 11, textAlign: "center", marginTop: 20 },
  pressed: { opacity: 0.75 },
});
