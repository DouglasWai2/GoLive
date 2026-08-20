import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { RTCView } from "react-native-webrtc";
import type { MediaStream as RNMediaStream } from "react-native-webrtc";
import type { MediaStream, RemoteVideoStats } from "@golive/core";
import { StreamStats } from "./StreamStats";
import { StatsButton } from "./StatsButton";
import { VolumeControl } from "./VolumeControl";

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
  useEffect(() => {
    if (!visible) return;

    ScreenOrientation.unlockAsync().catch(() => {});

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, [visible]);

  const rnStream = stream as unknown as RNMediaStream | null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <View style={styles.shell}>
        {rnStream ? (
          <RTCView
            style={styles.video}
            streamURL={rnStream.toURL()}
            objectFit="contain"
            mirror={false}
          />
        ) : null}

        <View style={styles.meta}>
          <View style={styles.liveDot} />
          <Text style={styles.name} numberOfLines={1}>
            {name}'s screen
          </Text>
        </View>

        {statsEnabled && stats ? <StreamStats stats={stats} /> : null}

        <View style={styles.controls}>
          <StatsButton statsEnabled={statsEnabled} onToggle={onToggleStats} />
          <VolumeControl
            volume={volume}
            muted={muted}
            onVolumeChange={onVolumeChange}
            onToggleMute={onToggleMute}
          />
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Exit fullscreen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  video: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
  },
  meta: {
    position: "absolute",
    left: 18,
    bottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(16,16,14,0.88)",
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff4433",
  },
  name: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
  },
  controls: {
    position: "absolute",
    right: 18,
    bottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  closeButton: {
    backgroundColor: "rgba(16,16,14,0.88)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  closeText: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
  },
});