import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { joinRoom, verifyInvite } from "@golive/core";
import { SIGNALING_URL } from "../config";
import { saveSession } from "../session";

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

  const join = async () => {
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Pick a display name to continue.");
      return;
    }

    setIsJoining(true);
    setError("");

    try {
      const { token } = inviteToken
        ? await verifyInvite(SIGNALING_URL, roomId, trimmed, inviteToken)
        : await joinRoom(SIGNALING_URL, roomId, trimmed);

      await saveSession(roomId, trimmed, token, inviteToken);
      onJoined(trimmed, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join the room.");
      setIsJoining(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.roomLabel}>Room</Text>
        <Text style={styles.roomId}>{roomId}</Text>

        <Text style={styles.title}>What should we call you?</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Display name"
          placeholderTextColor="#6f6f68"
          maxLength={32}
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={join}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, isJoining && styles.buttonDisabled]}
          disabled={isJoining}
          onPress={join}
        >
          {isJoining ? (
            <ActivityIndicator color="#17130a" />
          ) : (
            <Text style={styles.primaryText}>Enter room</Text>
          )}
        </Pressable>

        <Pressable style={styles.ghostButton} onPress={onBack} disabled={isJoining}>
          <Text style={styles.ghostText}>Back</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#10100e",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#17170f",
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  roomLabel: {
    color: "#6f6f68",
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  roomId: {
    color: "#ffb13b",
    fontSize: 22,
    fontWeight: "700",
  },
  title: {
    color: "#f2f1ec",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 8,
  },
  input: {
    backgroundColor: "#10100e",
    borderWidth: 1,
    borderColor: "#2c2c26",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f2f1ec",
    fontSize: 15,
  },
  error: {
    color: "#ff6b5e",
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: "#ffb13b",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: "#17130a",
    fontSize: 16,
    fontWeight: "700",
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: "#2c2c26",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  ghostText: {
    color: "#d5d4cd",
    fontSize: 14,
  },
});