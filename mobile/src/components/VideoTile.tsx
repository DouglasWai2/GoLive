import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
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

type DimensionsChangeEvent = { nativeEvent: { width: number; height: number } };
const IOS_FRAME_SETTLE_MS = 350;

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
  const [frameReadyStream, setFrameReadyStream] = useState<MediaStream | null>(null);
  const frameReadyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPreview = variant === "preview";
  const isStage = variant === "stage";
  const showStats = isStage;

  const markFrameReady = useCallback(() => {
    if (frameReadyTimer.current) {
      clearTimeout(frameReadyTimer.current);
      frameReadyTimer.current = null;
    }
    setFrameReadyStream(stream);
  }, [stream]);

  const handleDimensionsChange = useCallback((event: DimensionsChangeEvent) => {
    onDimensionsChange(event);
    const { width: frameWidth, height: frameHeight } = event.nativeEvent;
    if (frameWidth <= 0 || frameHeight <= 0 || (frameWidth === 2 && frameHeight === 2)) return;

    // Android reports dimensions before SurfaceViewRenderer presents its first frame.
    // iOS has no first-frame event, so leave the cover up briefly after dimensions arrive.
    if (Platform.OS === "android") return;
    if (frameReadyTimer.current) clearTimeout(frameReadyTimer.current);
    frameReadyTimer.current = setTimeout(markFrameReady, IOS_FRAME_SETTLE_MS);
  }, [markFrameReady, onDimensionsChange]);

  useEffect(() => {
    setFrameReadyStream(null);
    if (frameReadyTimer.current) {
      clearTimeout(frameReadyTimer.current);
      frameReadyTimer.current = null;
    }
    return () => {
      if (frameReadyTimer.current) clearTimeout(frameReadyTimer.current);
    };
  }, [stream]);

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
    <View style={[styles.tile, isStage && styles.tileStage, isPreview && !small && styles.tilePreview, small && styles.tileSmall]}>
      <RTCView
        style={styles.video}
        streamURL={rnStream.toURL()}
        objectFit="contain"
        mirror={false}
        {...(Platform.OS === "android" ? { zOrder: isPreview ? 1 : 0 } : {})}
        onDimensionsChange={handleDimensionsChange}
        onFirstFrameRendered={Platform.OS === "android" ? markFrameReady : undefined}
      />
      {!local ? (
        <VideoLoadingOverlay
          phase={frameReadyStream === stream ? playbackPhase : "loading"}
          connectionState={state}
          compact={!isStage}
        />
      ) : null}
      {showControls ? (
        <Pressable
          style={styles.tapArea}
          onPress={isPreview && onSelect ? onSelect : () => setControlsVisible((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={isPreview && onSelect
            ? `Show ${local ? "your" : `${name}'s`} screen on stage`
            : controlsVisible ? "Hide screen share controls" : "Show screen share controls"}
          accessibilityHint={isPreview && onSelect ? "Drag to move this thumbnail." : undefined}
        />
      ) : null}
      {isStage && controlsVisible ? (
        <View pointerEvents="none" style={styles.meta}>
          <View style={styles.liveDot} />
          <Text style={styles.name} numberOfLines={1}>
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
      {isStage && showBottomControls && controlsVisible ? (
        <View style={styles.controls}>
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
      {isStage && !local && (onMinimize || onStopWatching) && controlsVisible ? (
        <View style={styles.topControls}>
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
  tileStage: {
    width: "100%",
    height: "100%",
  },
  tilePreview: {
    flex: 0,
    width: "100%",
    aspectRatio: 16 / 10,
    minHeight: 0,
    maxHeight: 280,
    borderColor: "#56564e",
    borderRadius: radii.overlay,
  },
  tileSmall: {
    flex: 1,
    width: "100%",
    height: "100%",
    minHeight: 0,
    borderWidth: 0,
    borderRadius: 0,
  },
  video: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
  topControls: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  actionButton: { backgroundColor: "rgba(16,16,14,0.9)" },
  pressed: { opacity: 0.62 },
});
