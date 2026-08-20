import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { ShareSettings } from "@golive/core";
import {
  bitrateOptions,
  DEFAULT_SHARE_SETTINGS,
  frameRateOptions,
  resolutionOptions,
} from "@golive/core";

type ShareSheetProps = {
  visible: boolean;
  isStarting: boolean;
  onStart: (settings: ShareSettings) => void;
  onCancel: () => void;
};

export function ShareSheet({ visible, isStarting, onStart, onCancel }: ShareSheetProps) {
  const [settings, setSettings] = useState<ShareSettings>(DEFAULT_SHARE_SETTINGS);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={isStarting ? undefined : onCancel}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.head}>
            <Text style={styles.title}>Share your screen</Text>
            <Text style={styles.subtitle}>Quality caps for every viewer</Text>
          </View>

          <Text style={styles.label}>Resolution</Text>
          <View style={styles.segmented}>
            {resolutionOptions.map((option) => {
              const active =
                settings.width === option.width && settings.height === option.height;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.segment, active && styles.segmentActive]}
                  disabled={isStarting}
                  onPress={() =>
                    setSettings((current) => ({
                      ...current,
                      width: option.width,
                      height: option.height,
                    }))
                  }
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option.label}
                  </Text>
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
                  onPress={() =>
                    setSettings((current) => ({ ...current, frameRate: option.value }))
                  }
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option.label} fps
                  </Text>
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
                  onPress={() =>
                    setSettings((current) => ({ ...current, maxBitrate: option.value }))
                  }
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={onCancel} disabled={isStarting}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.startButton, isStarting && styles.buttonDisabled]}
              disabled={isStarting}
              onPress={() => onStart(settings)}
            >
              <Text style={styles.startText}>
                {isStarting ? "Choosing a screen..." : "Start sharing"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#16160f",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 34,
  },
  head: {
    marginBottom: 18,
  },
  title: {
    color: "#f2f1ec",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#9c9c93",
    fontSize: 13,
    marginTop: 2,
  },
  label: {
    color: "#9c9c93",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 8,
  },
  segmented: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2c2c26",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentActive: {
    borderColor: "#ffb13b",
    backgroundColor: "rgba(255,177,59,0.12)",
  },
  segmentText: {
    color: "#d5d4cd",
    fontSize: 13,
  },
  segmentTextActive: {
    color: "#ffb13b",
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2c2c26",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelText: {
    color: "#d5d4cd",
    fontSize: 15,
  },
  startButton: {
    flex: 2,
    backgroundColor: "#ffb13b",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  startText: {
    color: "#17130a",
    fontSize: 15,
    fontWeight: "700",
  },
});