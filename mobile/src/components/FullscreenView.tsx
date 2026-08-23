import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import { RTCView } from "react-native-webrtc";
import type { MediaStream as RNMediaStream } from "react-native-webrtc";
import type { MediaStream, RemoteVideoStats } from "@golive/core";
import { FullscreenExitIcon } from "./icons";
import { StreamStats } from "./StreamStats";
import { StatsButton } from "./StatsButton";
import { VolumeControl } from "./VolumeControl";
import { colors, radii } from "../theme";

type FullscreenViewProps = {
  visible: boolean;
  stream: MediaStream | null;
  name: string;
  stats?: RemoteVideoStats | null;
  statsEnabled: boolean;
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleStats: () => void;
  onClose: () => void;
};

export function FullscreenView({
  visible,
  stream,
  name,
  stats,
  statsEnabled,
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
  onToggleStats,
  onClose,
}: FullscreenViewProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const revealControls = () => {
    setControlsVisible(true);
    clearTimer();
    timer.current = setTimeout(() => setControlsVisible(false), 2500);
  };

  useEffect(() => {
    if (!visible) return;

    StatusBar.setHidden(true, "fade");
    ScreenOrientation.unlockAsync().catch(() => {});
    revealControls();

    return () => {
      clearTimer();
      StatusBar.setHidden(false, "fade");
      StatusBar.setBarStyle("light-content", true);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [visible]);

  const rnStream = stream as unknown as RNMediaStream | null;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <View style={styles.shell}>
        {rnStream ? (
          <RTCView style={styles.video} streamURL={rnStream.toURL()} objectFit="contain" mirror={false} />
        ) : null}

        <Pressable
          style={styles.revealTap}
          onPress={() => controlsVisible ? setControlsVisible(false) : revealControls()}
          accessibilityLabel={controlsVisible ? "Hide fullscreen controls" : "Show fullscreen controls"}
        />

        <View
          pointerEvents={controlsVisible ? "box-none" : "none"}
          accessibilityElementsHidden={!controlsVisible}
          importantForAccessibility={controlsVisible ? "auto" : "no-hide-descendants"}
          style={[styles.overlay, !controlsVisible && styles.overlayHidden]}
        >
          <View pointerEvents="none" style={[styles.meta, { left: Math.max(insets.left, 18), bottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.liveDot} />
            <Text style={styles.name} numberOfLines={1}>{name}'s screen</Text>
          </View>

          {statsEnabled && stats ? <StreamStats stats={stats} fullscreen /> : null}

          <View
            style={[styles.controls, { right: Math.max(insets.right, 18), bottom: Math.max(insets.bottom, 18) }]}
            onTouchStart={clearTimer}
            onTouchEnd={revealControls}
            onTouchCancel={revealControls}
          >
            <StatsButton statsEnabled={statsEnabled} onToggle={onToggleStats} />
            <VolumeControl volume={volume} muted={muted} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} />
            <Pressable style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Exit fullscreen">
              <FullscreenExitIcon color="#b5b5ad" />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.black, alignItems: "center", justifyContent: "center" },
  video: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.black },
  revealTap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 1 },
  overlayHidden: { opacity: 0 },
  meta: { position: "absolute", maxWidth: "45%", minHeight: 38, backgroundColor: "rgba(16,16,14,0.9)", paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  name: { color: colors.paper, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  controls: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 9 },
  closeButton: { width: 44, height: 44, backgroundColor: "rgba(16,16,14,0.9)", borderWidth: 1, borderColor: "#3d3d36", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.62 },
});
