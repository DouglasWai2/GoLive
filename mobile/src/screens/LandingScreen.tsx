import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { createRoomId } from "../utils/roomId";

type LandingScreenProps = {
  onJoinRoom: (roomId: string) => void;
};

export function LandingScreen({ onJoinRoom }: LandingScreenProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const join = () => {
    const trimmed = input.trim();
    const match = trimmed.match(/(?:\/room\/)([a-zA-Z0-9_-]{1,64})/);

    const roomId = match ? match[1] : /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;

    if (!roomId) {
      setError("Enter a room code or a GoLive link.");
      return;
    }

    setError("");
    onJoinRoom(roomId);
  };

  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.brand}>
        <Text style={styles.brandName}>GoLive</Text>
        <Text style={styles.brandTagline}>Screen sharing that never touches a server</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Join a room</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Room code or invite link"
          placeholderTextColor="#6f6f68"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={join}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={join}>
          <Text style={styles.primaryText}>Enter room</Text>
        </Pressable>

        <Pressable style={styles.ghostButton} onPress={() => onJoinRoom(createRoomId())}>
          <Text style={styles.ghostText}>Create a room</Text>
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
  brand: {
    alignItems: "center",
    marginBottom: 36,
  },
  brandName: {
    color: "#f2f1ec",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  brandTagline: {
    color: "#9c9c93",
    fontSize: 14,
    marginTop: 6,
  },
  card: {
    backgroundColor: "#17170f",
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  title: {
    color: "#f2f1ec",
    fontSize: 20,
    fontWeight: "700",
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
  primaryText: {
    color: "#17130a",
    fontSize: 16,
    fontWeight: "700",
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: "#2c2c26",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  ghostText: {
    color: "#d5d4cd",
    fontSize: 15,
  },
});