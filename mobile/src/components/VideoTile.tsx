import { Pressable, StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { MediaStream as RNMediaStream } from "react-native-webrtc";
import type { MediaStream, PeerConnectionState, RemoteVideoStats } from "@golive/core";
import { StreamStats, type OutboundStatsEntry } from "./StreamStats";
import { StatsButton } from "./StatsButton";
import { VolumeControl } from "./VolumeControl";
import { FullscreenIcon } from "./icons";
import { colors, radii, technicalText } from "../theme";
import { useVideoPlaybackState } from "../hooks/useVideoPlaybackState";
import { VideoLoadingOverlay } from "./VideoLoadingOverlay";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  state?: PeerConnectionState | null;
  small?: boolean;
  local?: boolean;
  qualityLabel?: string | null;
  stats?: RemoteVideoStats | null;
  outboundStats?: OutboundStatsEntry[];
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
  qualityLabel,
  stats,
  outboundStats = [],
  statsEnabled = true,
  volume = 1,
  muted = false,
  onVolumeChange,
  onToggleMute,
  onToggleStats,
  onFullscreen,
}: VideoTileProps) {
  const rnStream = stream as unknown as RNMediaStream;
  const hasAudio = rnStream.getAudioTracks().length > 0;
  const { phase: playbackPhase, onDimensionsChange } = useVideoPlaybackState(stream, !local);

  const showControls = local
    ? Boolean(onToggleStats)
    : Boolean(onVolumeChange || onToggleStats || onFullscreen);

  return (
    <View style={[styles.tile, small && styles.tileSmall]}>
      <RTCView
        style={styles.video}
        streamURL={rnStream.toURL()}
        objectFit="contain"
        mirror={false}
        onDimensionsChange={onDimensionsChange}
      />
      {!local ? <VideoLoadingOverlay phase={playbackPhase} connectionState={state} /> : null}
      <View style={styles.meta}>
        <View style={styles.liveDot} />
        <Text style={styles.name} numberOfLines={1}>
          {local ? "Your screen" : `${name}'s screen`}
        </Text>
        {local && qualityLabel ? <Text style={styles.state} numberOfLines={1}>{qualityLabel}</Text> : null}
        {state ? <Text style={styles.state}>{state}</Text> : null}
      </View>
      {statsEnabled && stats ? <StreamStats stats={stats} /> : null}
      {local && statsEnabled && outboundStats.length > 0 ? (
        <StreamStats outbound={outboundStats} />
      ) : null}
      {showControls ? (
        <View style={styles.controls}>
          {onToggleStats ? (
            <StatsButton statsEnabled={statsEnabled} onToggle={onToggleStats} />
          ) : null}
          {onVolumeChange && onToggleMute ? (
            <VolumeControl
              volume={volume}
              muted={muted}
              disabled={!hasAudio}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />
          ) : null}
          {onFullscreen ? (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              onPress={onFullscreen}
              accessibilityRole="button"
              accessibilityLabel="Fullscreen"
            >
              <FullscreenIcon color="#b5b5ad" />
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
    backgroundColor: colors.video,
    borderWidth: 1,
    borderColor: "#2d2d29",
    overflow: "hidden",
  },
  tileSmall: {
    minHeight: 96,
  },
  video: {
    flex: 1,
    backgroundColor: "#000",
  },
  meta: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16,16,14,0.9)",
    minHeight: 34,
    paddingHorizontal: 10,
    zIndex: 3,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.red,
  },
  name: {
    color: colors.paper,
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
  },
  state: {
    ...technicalText,
    color: "#77776f",
    fontSize: 8,
    borderLeftWidth: 1,
    borderLeftColor: "#42423d",
    paddingLeft: 7,
    maxWidth: 155,
  },
  controls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 3,
  },
  button: {
    backgroundColor: "rgba(16,16,14,0.88)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: radii.control,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.62 },
});
