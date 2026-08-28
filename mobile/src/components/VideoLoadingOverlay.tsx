import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { PeerConnectionState } from "@golive/core";
import type { VideoPlaybackPhase } from "../hooks/useVideoPlaybackState";
import { ScreenIcon } from "./icons";
import { colors } from "../theme";

type VideoLoadingOverlayProps = {
  phase: VideoPlaybackPhase;
  connectionState?: PeerConnectionState | null;
};

function loadingCopy(phase: VideoPlaybackPhase, connectionState?: PeerConnectionState | null) {
  if (connectionState === "new" || connectionState === "connecting") {
    return {
      title: "Negotiating secure connection",
      message: "Checking available peer and relay paths.",
    };
  }

  if (connectionState === "disconnected") {
    return {
      title: "Reconnecting stream",
      message: "The secure media connection was interrupted.",
    };
  }

  if (connectionState === "failed") {
    return {
      title: "Trying another connection path",
      message: "The direct media path could not be established.",
    };
  }

  if (phase === "buffering") {
    return {
      title: "Stream interrupted",
      message: "Waiting for video to resume.",
    };
  }

  if (phase === "ended") {
    return {
      title: "Screen stream ended",
      message: "Waiting for the presenter to reconnect.",
    };
  }

  if (phase === "error") {
    return {
      title: "Video could not play",
      message: "The device could not render this stream.",
    };
  }

  return {
    title: "Waiting for video",
    message: "The connection is ready; waiting for the first frame.",
  };
}

export function VideoLoadingOverlay({ phase, connectionState }: VideoLoadingOverlayProps) {
  if (phase === "playing" && connectionState !== "disconnected" && connectionState !== "failed") {
    return null;
  }

  const copy = loadingCopy(phase, connectionState);

  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${copy.title}. ${copy.message}`}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.screen}>
        <ScreenIcon size={30} color="#77776f" />
        <View style={styles.scanLine} />
      </View>
      <ActivityIndicator size="small" color={colors.acid} style={styles.indicator} />
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.message}>{copy.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(8,8,8,0.97)",
  },
  screen: {
    width: 84,
    height: 58,
    borderWidth: 1,
    borderColor: "#4a4a44",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 14,
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: 1,
    backgroundColor: colors.acid,
    opacity: 0.45,
  },
  indicator: { marginBottom: 11 },
  title: { color: colors.paper, fontSize: 15, fontWeight: "700", textAlign: "center" },
  message: { color: "#7e7e76", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 6 },
});
