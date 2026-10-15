import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import type { MediaStream, Peer } from "@golive/core";
import { MicrophoneIcon, MicrophoneMutedIcon, ScreenIcon, UsersIcon } from "./icons";
import { VideoTile } from "./VideoTile";
import { colors, radii, technicalText } from "../theme";

type ParticipantsGridProps = {
  localName: string;
  localStream: MediaStream | null;
  localMicMuted: boolean;
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
  peers,
  focusedPeerId,
  focusedStream,
  onFocusPeer,
  onFocusLocal,
  onOpenParticipants,
}: ParticipantsGridProps) {
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
  const columns = Math.min(3, Math.ceil(Math.sqrt(slots)));
  const rows = Math.ceil(slots / columns);
  const cells: Array<ParticipantCell | { kind: "more" }> = [
    ...visible,
    ...(hiddenCount > 0 ? [{ kind: "more" as const }] : []),
  ];

  return (
    <View style={styles.grid} accessibilityLabel="People in the call">
      {Array.from({ length: rows }, (_, rowIndex) => {
        const rowCells = cells.slice(rowIndex * columns, (rowIndex + 1) * columns);
        const isPartialRow = rowCells.length < columns;
        const partialCardWidth: ViewStyle | null = isPartialRow
          ? { width: `${100 / columns}%` as `${number}%`, flexGrow: 0 }
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
                  : "Microphone on";
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
                    <Text style={styles.voiceStatus} numberOfLines={1}>{voiceStatus}</Text>
                  </View>
                </>
              );

              const cardStyle = [
                styles.card,
                cell.sharing && styles.sharingCard,
                isFocusedRemote && styles.focusedCard,
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
                    ? "Show your screen on stage"
                    : `${isFocusedRemote ? "Focused on" : "Watch"} ${cell.name}'s screen`}
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
