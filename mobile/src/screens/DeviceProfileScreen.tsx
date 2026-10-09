import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "../components/Brand";
import { colors, radii, raisedSurface, technicalText } from "../theme";

type DeviceProfileScreenProps = {
  initialName: string;
  onBack: () => void;
  onSave: (name: string) => Promise<void>;
};

export function DeviceProfileScreen({ initialName, onBack, onSave }: DeviceProfileScreenProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 32 || saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await onSave(trimmed);
      setName(trimmed);
      setSaved(true);
    } catch {
      setError("Could not save your profile. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView style={styles.safeArea} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Brand compact />
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack} accessibilityRole="button">
            <Text style={styles.backText}>My rooms</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View style={styles.eyebrow}><View style={styles.acidDot} /><Text style={styles.eyebrowText}>Device profile</Text></View>
            <Text style={styles.title}>Your profile</Text>
            <Text style={styles.description}>This display name follows you into every room on this device.</Text>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(value) => { setName(value); setSaved(false); if (error) setError(""); }}
              maxLength={32}
              autoComplete="nickname"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              accessibilityLabel="Display name"
            />
            <Text style={styles.hint}>Up to 32 characters. Changes appear in rooms that are already open.</Text>
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            {saved ? <Text style={styles.success} accessibilityLiveRegion="polite">Profile saved.</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.saveButton, (!name.trim() || saving) && styles.disabled, pressed && styles.pressed]}
              disabled={!name.trim() || saving}
              onPress={() => void save()}
              accessibilityRole="button"
            >
              <Text style={styles.saveText}>{saving ? "Saving…" : "Save profile"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  header: { minHeight: 68, marginHorizontal: 22, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { minHeight: 44, paddingHorizontal: 6, justifyContent: "center" },
  backText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  content: { flexGrow: 1, justifyContent: "center", padding: 22, paddingBottom: 40 },
  card: { width: "100%", maxWidth: 520, alignSelf: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 28, ...raisedSurface },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 18 },
  acidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.acid },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 9 },
  title: { color: colors.paper, fontSize: 32, lineHeight: 36, fontWeight: "800", letterSpacing: -1.4 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 11, marginBottom: 29 },
  label: { color: "#aaa9a0", fontSize: 12, marginBottom: 9 },
  input: { minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.lineStrong, color: colors.paper, fontSize: 15, backgroundColor: colors.ink },
  hint: { color: colors.dim, fontSize: 10, lineHeight: 15, marginTop: 9 },
  error: { color: colors.redText, fontSize: 12, lineHeight: 18, marginTop: 12 },
  success: { color: colors.acid, fontSize: 12, marginTop: 12 },
  saveButton: { minHeight: 49, marginTop: 22, borderRadius: radii.control, backgroundColor: colors.acid, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.acidInk, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.75 },
});
