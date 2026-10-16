import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import type { MediaStream, Peer } from "@golive/core";
import { MicrophoneIcon, MicrophoneMutedIcon, ScreenIcon, UsersIcon } from "./icons";
import { VideoTile } from "./VideoTile";
import { colors, radii, technicalText } from "../theme";
import { getParticipantGridColumns } from "../utils/participantGridLayout";

type ParticipantsGridProps = {
  localName: string;
  localStream: MediaStream | null;
  localMicMuted: boolean;
  localSpeaking: boolean;
  speakingPeerIds: Set<string>;
  peers: Peer[];
  focusedPeerId: string | null;
  focusedStream: MediaStream | null;
  onFocusPeer: (peerId: string) => void;
  onFocusLocal: () => void;
  onOpenParticipants: () => void;
};

type ParticipantCell = {
  id: string;
  name: string;
  local: boolean;
  sharing: boolean;
  voiceJoined: boolean;
  micMuted: boolean;
};

const GRID_GAP = 8;
const MAX_GRID_CARDS = 9;
const LOCAL_PARTICIPANT_ID = "__golive_local_participant__";

export function ParticipantsGrid({
  localName,
  localStream,
  localMicMuted,
  localSpeaking,
  speakingPeerIds,
  peers,
  focusedPeerId,
  focusedStream,
  onFocusPeer,
  onFocusLocal,
  onOpenParticipants,
}: ParticipantsGridProps) {
  const speakerPulse = useRef(new Animated.Value(0.35)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const hasSpeakingParticipant = localSpeaking || speakingPeerIds.size > 0;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!hasSpeakingParticipant || reduceMotion !== false) {
      speakerPulse.stopAnimation();
      speakerPulse.setValue(hasSpeakingParticipant ? 0.65 : 0.35);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(speakerPulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(speakerPulse, {
          toValue: 0.35,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [hasSpeakingParticipant, reduceMotion, speakerPulse]);

  const participants: ParticipantCell[] = [
    {
      id: LOCAL_PARTICIPANT_ID,
      name: localName,
      local: true,
      sharing: Boolean(localStream),
      voiceJoined: true,
      micMuted: localMicMuted,
    },
    ...peers.map((peer) => ({
      id: peer.id,
      name: peer.name,
      local: false,
      sharing: peer.sharing && Boolean(peer.streamId),
      voiceJoined: peer.voiceJoined ?? false,
      micMuted: peer.micMuted ?? true,
    })),
  ];
  const hiddenCount = participants.length > MAX_GRID_CARDS
    ? participants.length - (MAX_GRID_CARDS - 1)
    : 0;
  const visible = participants.slice(0, hiddenCount ? MAX_GRID_CARDS - 1 : MAX_GRID_CARDS);

  if (hiddenCount && focusedPeerId && !visible.some((participant) => participant.id === focusedPeerId)) {
    const focusedParticipant = participants.find((participant) => participant.id === focusedPeerId);
    if (focusedParticipant) visible[visible.length - 1] = focusedParticipant;
  }

  const slots = visible.length + Number(hiddenCount > 0);
  const columns = getParticipantGridColumns(slots, gridSize.width, gridSize.height);
  const rows = Math.ceil(slots / columns);
  const cells: Array<ParticipantCell | { kind: "more" }> = [
    ...visible,
    ...(hiddenCount > 0 ? [{ kind: "more" as const }] : []),
  ];

  return (
    <View
      style={styles.grid}
      accessibilityLabel="People in the call"
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setGridSize((current) => current.width === width && current.height === height
          ? current
          : { width, height });
      }}
    >
      {Array.from({ length: rows }, (_, rowIndex) => {
        const rowCells = cells.slice(rowIndex * columns, (rowIndex + 1) * columns);
        const isPartialRow = rowCells.length < columns;
        const partialWidth = `${100 / columns}%` as `${number}%`;
        const partialCardWidth: ViewStyle | null = isPartialRow
          ? {
              width: partialWidth,
              flexBasis: partialWidth,
              flexGrow: 0,
              flexShrink: 0,
            }
          : null;

        return (
          <View key={`row-${rowIndex}`} style={styles.row}>
            {rowCells.map((cell) => {
              if ("kind" in cell) {
                return (
                  <Pressable
                    key="more"
                    style={({ pressed }) => [
                      styles.card,
                      styles.moreCard,
                      partialCardWidth,
                      pressed && styles.pressed,
                    ]}
                    onPress={onOpenParticipants}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${hiddenCount} more people in the call`}
                  >
                    <UsersIcon size={22} color="#b8c597" />
                    <Text style={styles.moreCount}>+{hiddenCount}</Text>
                    <Text style={styles.moreLabel}>More people</Text>
                  </Pressable>
                );
              }

              const isFocusedRemote = !cell.local && cell.id === focusedPeerId;
              const stream = cell.local
                ? localStream
                : isFocusedRemote
                  ? focusedStream
                  : null;
              const voiceStatus = !cell.voiceJoined
                ? "No voice"
                : cell.micMuted
                  ? "Microphone muted"
                  : (cell.local ? localSpeaking : speakingPeerIds.has(cell.id))
                    ? "Speaking"
                    : "Microphone on";
              const speaking = cell.voiceJoined
                && !cell.micMuted
                && (cell.local ? localSpeaking : speakingPeerIds.has(cell.id));
              const cardContent = (
                <>
                  {stream ? (
                    <VideoTile
                      stream={stream}
                      name={cell.name}
                      local={cell.local}
                      small
                      variant="preview"
                    />
                  ) : (
                    <View style={styles.avatar} accessibilityElementsHidden>
                      <Text style={styles.avatarText}>{cell.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.voiceBadge} accessibilityLabel={voiceStatus}>
                    {cell.voiceJoined && !cell.micMuted
                      ? <MicrophoneIcon size={14} color={colors.acid} />
                      : <MicrophoneMutedIcon size={14} color={colors.muted} />}
                  </View>
                  {cell.sharing ? (
                    <View style={styles.sharingBadge} pointerEvents="none">
                      <ScreenIcon size={13} color={colors.acid} />
                      <Text style={styles.sharingText}>
                        {cell.local
                          ? "YOUR SCREEN"
                          : isFocusedRemote && focusedStream
                            ? "WATCHING"
                            : isFocusedRemote
                              ? "CONNECTING"
                              : "SHARING"}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.nameBar} pointerEvents="none">
                    <Text style={styles.name} numberOfLines={1}>
                      {cell.name}{cell.local ? " (you)" : ""}
                    </Text>
                  </View>
                  {speaking ? (
                    <Animated.View
                      accessible={false}
                      pointerEvents="none"
                      style={[styles.speakingAura, { opacity: speakerPulse }]}
                    />
                  ) : null}
                </>
              );

              const cardStyle = [
                styles.card,
                cell.sharing && styles.sharingCard,
                isFocusedRemote && styles.focusedCard,
                speaking && styles.speakingCard,
                partialCardWidth,
              ];

              return cell.sharing ? (
                <Pressable
                  key={cell.id}
                  style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}
                  onPress={cell.local ? onFocusLocal : () => onFocusPeer(cell.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: cell.local ? false : isFocusedRemote }}
                  accessibilityLabel={cell.local
                    ? `Show your screen on stage${speaking ? ", speaking" : ""}`
                    : `${isFocusedRemote ? "Focused on" : "Watch"} ${cell.name}'s screen${speaking ? ", speaking" : ""}`}
                >
                  {cardContent}
                </Pressable>
              ) : (
                <View
                  key={cell.id}
                  style={cardStyle}
                  accessible
                  accessibilityLabel={`${cell.name}${cell.local ? ", you" : ""}, ${voiceStatus}, not sharing a screen`}
                >
                  {cardContent}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    minHeight: 260,
    gap: GRID_GAP,
  },
  row: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    gap: GRID_GAP,
  },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#45453d",
    borderRadius: radii.overlay,
    backgroundColor: "#22221e",
  },
  sharingCard: {
    borderColor: "rgba(201,255,66,0.55)",
    backgroundColor: "#25291f",
  },
  focusedCard: {
    borderColor: colors.acid,
  },
  speakingCard: {
    borderColor: colors.acid,
    boxShadow: "0 0 14px rgba(201, 255, 66, 0.22)",
  },
  speakingAura: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 2,
    borderRadius: radii.overlay,
    borderColor: "rgba(201,255,66,0.9)",
    backgroundColor: "rgba(201,255,66,0.035)",
  },
  avatar: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 29,
    backgroundColor: "#383832",
  },
  avatarText: {
    color: colors.paper,
    fontSize: 23,
    fontWeight: "700",
  },
  voiceBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 2,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: "rgba(16,16,14,0.9)",
  },
  sharingBadge: {
    position: "absolute",
    bottom: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: "rgba(16,16,14,0.9)",
  },
  sharingText: {
    ...technicalText,
    color: colors.acid,
    fontSize: 8,
  },
  nameBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 5,
    justifyContent: "center",
    backgroundColor: "rgba(16,16,14,0.92)",
  },
  name: {
    color: colors.paper,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  voiceStatus: {
    color: colors.muted,
    fontSize: 8,
    textAlign: "center",
  },
  speakingVoiceStatus: {
    color: colors.acid,
    fontWeight: "700",
  },
  moreCard: {
    flexGrow: 1,
    gap: 5,
    backgroundColor: "#262822",
  },
  moreCount: {
    color: colors.paper,
    fontSize: 22,
    fontWeight: "800",
  },
  moreLabel: {
    color: colors.muted,
    fontSize: 10,
  },
  pressed: {
    opacity: 0.75,
  },
});
