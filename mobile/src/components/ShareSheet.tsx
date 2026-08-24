import { useState } from "react";
import {
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ShareSettings } from "@golive/core";
import {
  bitrateOptions,
  DEFAULT_SHARE_SETTINGS,
  frameRateOptions,
  resolutionOptions,
} from "@golive/core";
import { colors, controlShadow, radii, technicalText } from "../theme";

type ShareSheetProps = {
  visible: boolean;
  isStarting: boolean;
  onStart: (settings: ShareSettings) => void;
  onCancel: () => void;
};

type AudioPermissionIssue = "denied" | "blocked";

const supportsDeviceAudio = Platform.OS === "android" && Number(Platform.Version) >= 29;

export function ShareSheet({ visible, isStarting, onStart, onCancel }: ShareSheetProps) {
  const [settings, setSettings] = useState<ShareSettings>(() => ({
    ...DEFAULT_SHARE_SETTINGS,
    includeAudio: supportsDeviceAudio,
  }));
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [audioPermissionIssue, setAudioPermissionIssue] = useState<AudioPermissionIssue | null>(null);
  const insets = useSafeAreaInsets();
  const busy = isStarting || requestingPermission;

  const startSharing = async () => {
    if (!settings.includeAudio) {
      onStart(settings);
      return;
    }

    setRequestingPermission(true);
    setAudioPermissionIssue(null);

    try {
      const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
      const alreadyGranted = await PermissionsAndroid.check(permission);
      const result = alreadyGranted
        ? PermissionsAndroid.RESULTS.GRANTED
        : await PermissionsAndroid.request(permission, {
            title: "Share device audio",
            message: "Android requires microphone permission to capture audio playing on this device. GoLive does not share your microphone.",
            buttonPositive: "Continue",
            buttonNegative: "Not now",
          });

      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        onStart(settings);
        return;
      }

      setAudioPermissionIssue(
        result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied",
      );
    } catch {
      setAudioPermissionIssue("denied");
    } finally {
      setRequestingPermission(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? () => {} : onCancel}>
      <Pressable
        style={styles.backdrop}
        onPress={busy ? undefined : onCancel}
        accessibilityRole="button"
        accessibilityLabel="Close share settings"
      >
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}
          onPress={(event) => event.stopPropagation()}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.head}>
              <Text style={styles.title}>Share your screen</Text>
              <Text style={styles.subtitle}>Output quality caps for every viewer</Text>
            </View>

          <Text style={styles.label}>Resolution</Text>
          <View style={styles.segmented}>
            {resolutionOptions.map((option) => {
              const active = settings.width === option.width && settings.height === option.height;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.segment, active && styles.segmentActive]}
                  disabled={busy}
                  onPress={() => setSettings((current) => ({ ...current, width: option.width, height: option.height }))}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: busy }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Frame rate</Text>
          <View style={styles.segmented}>
            {frameRateOptions.map((option) => {
              const active = settings.frameRate === option.value;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.segment, active && styles.segmentActive]}
                  disabled={busy}
                  onPress={() => setSettings((current) => ({ ...current, frameRate: option.value }))}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: busy }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label} fps</Text>
                </Pressable>
              );
            })}
          </View>

            <Text style={styles.label}>Max bitrate</Text>
          <View style={styles.segmented}>
            {bitrateOptions.map((option) => {
              const active = settings.maxBitrate === option.value;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.segment, active && styles.segmentActive]}
                  disabled={busy}
                  onPress={() => setSettings((current) => ({ ...current, maxBitrate: option.value }))}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: busy }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
            </View>

            <View style={[styles.audioSetting, !supportsDeviceAudio && styles.audioSettingDisabled]}>
              <View style={styles.audioCopy}>
                <Text style={styles.audioTitle}>Share device audio</Text>
                <Text style={styles.audioBody}>
                  {supportsDeviceAudio
                    ? "On Android 10+, includes audio playing on this device. Your microphone is not shared."
                    : "Device audio sharing requires Android 10 or newer."}
                </Text>
              </View>
              <Switch
                value={supportsDeviceAudio && settings.includeAudio}
                disabled={!supportsDeviceAudio || busy}
                onValueChange={(includeAudio) => {
                  setAudioPermissionIssue(null);
                  setSettings((current) => ({ ...current, includeAudio }));
                }}
                trackColor={{ false: "#3b3b36", true: "#7d9d2d" }}
                thumbColor={settings.includeAudio ? colors.acid : "#8d8d84"}
                accessibilityLabel="Share device audio"
              />
            </View>

            <Text style={styles.audioNote}>
              Android labels playback capture as microphone access. Some source apps and protected content block audio capture and may remain silent.
            </Text>

            {audioPermissionIssue ? (
              <View style={styles.permissionError} accessibilityRole="alert">
                <Text style={styles.permissionErrorText}>
                  {audioPermissionIssue === "blocked"
                    ? "Permission is blocked. Enable Microphone for GoLive in Settings, or turn device audio off."
                    : "Permission was denied. Allow microphone access to share device audio, or turn device audio off."}
                </Text>
                {audioPermissionIssue === "blocked" ? (
                  <Pressable
                    style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
                    onPress={() => void Linking.openSettings().catch(() => {})}
                    accessibilityRole="button"
                  >
                    <Text style={styles.settingsButtonText}>Open Settings</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable style={styles.cancelButton} onPress={onCancel} disabled={busy} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.startButton, busy && styles.buttonDisabled]}
                disabled={busy}
                onPress={() => void startSharing()}
                accessibilityRole="button"
              >
                <Text style={styles.startText}>
                  {requestingPermission ? "Checking permission..." : isStarting ? "Choosing a screen..." : "Start sharing"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", backgroundColor: colors.surfaceRaised, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, borderWidth: 1, borderBottomWidth: 0, borderColor: "#3b3b36", paddingHorizontal: 18, paddingTop: 10, ...controlShadow },
  handle: { width: 34, height: 3, alignSelf: "center", backgroundColor: "#4b4b44", borderRadius: 2, marginBottom: 15 },
  sheetContent: { paddingBottom: 2 },
  head: { marginBottom: 17 },
  title: { color: colors.paper, fontSize: 18, fontWeight: "800", letterSpacing: -0.35 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 4 },
  label: { ...technicalText, color: "#9c9c93", fontSize: 9, marginTop: 12, marginBottom: 7 },
  segmented: { flexDirection: "row", gap: 4, backgroundColor: "#12120f", borderWidth: 1, borderColor: colors.line, borderRadius: 5, padding: 3 },
  segment: { flex: 1, minHeight: 36, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: colors.acid },
  segmentText: { color: "#8d8d84", fontSize: 11, fontWeight: "600" },
  segmentTextActive: { color: colors.acidInk, fontWeight: "800" },
  audioSetting: { minHeight: 66, marginTop: 17, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#373732", borderRadius: radii.control, backgroundColor: "#22221e", flexDirection: "row", alignItems: "center", gap: 12 },
  audioSettingDisabled: { opacity: 0.55 },
  audioCopy: { flex: 1 },
  audioTitle: { color: colors.paper, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  audioBody: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  audioNote: { color: "#77776f", fontSize: 10, lineHeight: 15, marginTop: 8 },
  permissionError: { marginTop: 10, padding: 11, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", backgroundColor: "rgba(255,93,74,0.08)", borderRadius: radii.control, flexDirection: "row", alignItems: "center", gap: 10 },
  permissionErrorText: { color: colors.redText, fontSize: 10, lineHeight: 15, flex: 1 },
  settingsButton: { minHeight: 34, paddingHorizontal: 10, borderWidth: 1, borderColor: "rgba(255,176,167,0.45)", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  settingsButtonText: { color: colors.redText, fontSize: 10, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: "#373732", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  cancelText: { color: "#b5b5ad", fontSize: 13, fontWeight: "700" },
  startButton: { flex: 2, minHeight: 44, borderRadius: radii.control, backgroundColor: colors.acid, alignItems: "center", justifyContent: "center" },
  startText: { color: colors.acidInk, fontSize: 13, fontWeight: "800" },
  buttonDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.7 },
});
