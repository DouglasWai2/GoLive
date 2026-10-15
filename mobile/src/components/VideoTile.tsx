import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { RTCView } from "react-native-webrtc";
import type { MediaStream as RNMediaStream } from "react-native-webrtc";
import type { MediaStream, PeerConnectionState, RemoteVideoStats } from "@golive/core";
import { StreamStats, type OutboundStatsEntry } from "./StreamStats";
import { StatsButton } from "./StatsButton";
import { VolumeControl } from "./VolumeControl";
import { CloseIcon, FullscreenIcon } from "./icons";
import { colors, radii, technicalText } from "../theme";
import { useVideoPlaybackState } from "../hooks/useVideoPlaybackState";
import { VideoLoadingOverlay } from "./VideoLoadingOverlay";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  state?: PeerConnectionState | null;
  small?: boolean;
  variant?: "stage" | "preview";
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
  onSelect?: () => void;
  onStopWatching?: () => void;
  onMinimize?: () => void;
};

function MinimizeIcon({ color = "#b5b5ad" }: { color?: string }) {
  return (
    <Svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d="M5 12h14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function VideoTile({
  stream,
  name,
  state,
  small = false,
  variant = "stage",
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
  onSelect,
  onStopWatching,
  onMinimize,
}: VideoTileProps) {
  const rnStream = stream as unknown as RNMediaStream;
  const hasAudio = rnStream.getAudioTracks().length > 0;
  const { phase: playbackPhase, onDimensionsChange } = useVideoPlaybackState(stream, !local);
  const [controlsVisible, setControlsVisible] = useState(true);
  const isPreview = variant === "preview";
  const showStats = variant === "stage";

  useEffect(() => {
    if (local || !onVolumeChange || !onToggleMute) return;

    for (const track of rnStream.getAudioTracks()) {
      track._setVolume(muted ? 0 : volume);
    }
  }, [local, volume, muted, stream, onVolumeChange, onToggleMute]);

  const showBottomControls = Boolean(
    (showStats && onToggleStats)
    || (!local && onVolumeChange && onToggleMute)
    || onFullscreen,
  );
  const showControls = showBottomControls || Boolean(onSelect) || (!local && Boolean(onStopWatching || onMinimize));

  return (
    <View style={[styles.tile, isPreview && styles.tilePreview, small && styles.tileSmall]}>
      <RTCView
        style={styles.video}
        streamURL={rnStream.toURL()}
        objectFit="contain"
        mirror={false}
        onDimensionsChange={onDimensionsChange}
      />
      {!local ? <VideoLoadingOverlay phase={playbackPhase} connectionState={state} /> : null}
      {showControls ? (
        <Pressable
          style={styles.tapArea}
          onPress={isPreview && onSelect ? onSelect : () => setControlsVisible((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={isPreview && onSelect
            ? `Show ${local ? "your" : `${name}'s`} screen on stage`
            : controlsVisible ? "Hide screen share controls" : "Show screen share controls"}
        />
      ) : null}
      {controlsVisible ? (
        <View pointerEvents="none" style={[styles.meta, isPreview && styles.metaPreview]}>
          <View style={styles.liveDot} />
          <Text style={[styles.name, isPreview && styles.namePreview]} numberOfLines={1}>
            {local ? "Your screen" : `${name}'s screen`}
          </Text>
          {local && qualityLabel ? <Text style={styles.state} numberOfLines={1}>{qualityLabel}</Text> : null}
          {state ? <Text style={styles.state}>{state}</Text> : null}
        </View>
      ) : null}
      {controlsVisible && showStats && !local && statsEnabled && stats ? <StreamStats stats={stats} /> : null}
      {controlsVisible && showStats && local && statsEnabled && outboundStats.length > 0 ? (
        <StreamStats outbound={outboundStats} />
      ) : null}
      {showBottomControls && controlsVisible ? (
        <View style={[styles.controls, isPreview && styles.controlsPreview]}>
          {showStats && onToggleStats ? (
            <StatsButton statsEnabled={statsEnabled} onToggle={onToggleStats} />
          ) : null}
          {!local && onVolumeChange && onToggleMute ? (
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
      {!local && (onMinimize || onStopWatching) && controlsVisible ? (
        <View style={[styles.topControls, isPreview && styles.topControlsPreview]}>
          {onMinimize ? (
            <Pressable
              style={({ pressed }) => [styles.button, styles.actionButton, pressed && styles.pressed]}
              onPress={onMinimize}
              accessibilityRole="button"
              accessibilityLabel="Minimize stream"
            >
              <MinimizeIcon />
            </Pressable>
          ) : null}
          {onStopWatching ? (
            <Pressable
              style={({ pressed }) => [styles.button, styles.actionButton, pressed && styles.pressed]}
              onPress={onStopWatching}
              accessibilityRole="button"
              accessibilityLabel={`Stop watching ${name}'s screen`}
            >
              <CloseIcon color="#e4e4dc" />
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
    borderRadius: radii.control,
  },
  tilePreview: {
    flex: 0,
    width: "100%",
    aspectRatio: 16 / 10,
    minHeight: 96,
    maxHeight: 280,
    borderColor: "#56564e",
    borderRadius: radii.overlay,
  },
  tileSmall: {
    minHeight: 96,
  },
  video: {
    flex: 1,
    backgroundColor: "#000",
  },
  tapArea: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  meta: {
    position: "absolute",
    left: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16,16,14,0.9)",
    minHeight: 34,
    paddingHorizontal: 10,
    zIndex: 3,
  },
  metaPreview: {
    left: 8,
    top: 8,
    maxWidth: "48%",
    minHeight: 28,
    paddingHorizontal: 8,
    gap: 6,
  },
  namePreview: { fontSize: 10 },
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
    alignItems: "flex-end",
    gap: 8,
    zIndex: 3,
  },
  controlsPreview: { right: 7, bottom: 7, gap: 5 },
  topControls: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 3,
  },
  topControlsPreview: { top: 7, right: 7, gap: 5 },
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
  actionButton: { backgroundColor: "rgba(16,16,14,0.9)" },
  pressed: { opacity: 0.62 },
});
