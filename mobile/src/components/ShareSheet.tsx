import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

export function ShareSheet({ visible, isStarting, onStart, onCancel }: ShareSheetProps) {
  const [settings, setSettings] = useState<ShareSettings>(DEFAULT_SHARE_SETTINGS);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable
        style={styles.backdrop}
        onPress={isStarting ? undefined : onCancel}
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
                  disabled={isStarting}
                  onPress={() => setSettings((current) => ({ ...current, width: option.width, height: option.height }))}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: isStarting }}
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
                  disabled={isStarting}
                  onPress={() => setSettings((current) => ({ ...current, frameRate: option.value }))}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: isStarting }}
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
                  disabled={isStarting}
                  onPress={() => setSettings((current) => ({ ...current, maxBitrate: option.value }))}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: isStarting }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

            <View style={styles.actions}>
              <Pressable style={styles.cancelButton} onPress={onCancel} disabled={isStarting} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.startButton, isStarting && styles.buttonDisabled]}
                disabled={isStarting}
                onPress={() => onStart(settings)}
                accessibilityRole="button"
              >
                <Text style={styles.startText}>{isStarting ? "Choosing a screen..." : "Start sharing"}</Text>
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
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: "#373732", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  cancelText: { color: "#b5b5ad", fontSize: 13, fontWeight: "700" },
  startButton: { flex: 2, minHeight: 44, borderRadius: radii.control, backgroundColor: colors.acid, alignItems: "center", justifyContent: "center" },
  startText: { color: colors.acidInk, fontSize: 13, fontWeight: "800" },
  buttonDisabled: { opacity: 0.42 },
});
