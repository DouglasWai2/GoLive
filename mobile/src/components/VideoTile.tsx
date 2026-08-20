import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { MediaStream as RNMediaStream } from "react-native-webrtc";
import type { MediaStream, PeerConnectionState, RemoteVideoStats } from "@golive/core";
import { StreamStats } from "./StreamStats";
import { StatsButton } from "./StatsButton";
import { VolumeControl } from "./VolumeControl";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  state?: PeerConnectionState | null;
  small?: boolean;
  local?: boolean;
  stats?: RemoteVideoStats | null;
  statsEnabled?: boolean;
  volume?: number;
  muted?: boolean;
  onVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleStats?: () => void;
  onFullscreen?: () => void;
};

export function VideoTile({
  stream,
  name,
  state,
  small = false,
  local = false,
  stats,
  statsEnabled = true,
  volume = 1,
  muted = false,
  onVolumeChange,
  onToggleMute,
  onToggleStats,
  onFullscreen,
}: VideoTileProps) {
  const rnStream = stream as unknown as RNMediaStream;

  useEffect(() => {
    if (local) return;

    for (const track of rnStream.getAudioTracks()) {
      track._setVolume(muted ? 0 : volume);
    }
  }, [local, volume, muted, stream]);

  const showControls = !local && (onVolumeChange || onToggleStats || onFullscreen);

  return (
    <View style={[styles.tile, small && styles.tileSmall]}>
      <RTCView
        style={styles.video}
        streamURL={rnStream.toURL()}
        objectFit="contain"
        mirror={false}
      />
      <View style={styles.meta}>
        <View style={styles.liveDot} />
        <Text style={styles.name} numberOfLines={1}>
          {local ? "Your screen" : `${name}'s screen`}
        </Text>
        {state ? <Text style={styles.state}>{state}</Text> : null}
      </View>
      {statsEnabled && stats ? <StreamStats stats={stats} /> : null}
      {showControls ? (
        <View style={styles.controls}>
          {onToggleStats ? (
            <StatsButton statsEnabled={statsEnabled} onToggle={onToggleStats} />
          ) : null}
          {onVolumeChange && onToggleMute ? (
            <VolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />
          ) : null}
          {onFullscreen ? (
            <Pressable style={styles.button} onPress={onFullscreen}>
              <Text style={styles.buttonText}>Fullscreen</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 200,
    backgroundColor: "#16160f",
    borderRadius: 12,
    overflow: "hidden",
  },
  tileSmall: {
    minHeight: 96,
    borderRadius: 8,
  },
  video: {
    flex: 1,
    backgroundColor: "#000",
  },
  meta: {
    position: "absolute",
    left: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16,16,14,0.75)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
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
    flexShrink: 1,
  },
  state: {
    color: "#9c9c93",
    fontSize: 12,
    textTransform: "capitalize",
  },
  controls: {
    position: "absolute",
    right: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  button: {
    backgroundColor: "rgba(16,16,14,0.88)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttonText: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
  },
});