import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Peer } from "@golive/core";
import {
  CloseIcon,
  MicrophoneIcon,
  MicrophoneMutedIcon,
  ScreenIcon,
  ScreenOffIcon,
} from "./icons";
import { colors, controlShadow, radii, technicalText } from "../theme";

type ParticipantsListProps = {
  participants: Peer[];
  name: string;
  voiceState?: {
    micMuted: boolean;
    voiceJoined: boolean;
  };
  visible?: boolean;
  onClose?: () => void;
  focusedPeerId?: string | null;
  onWatchPeer?: (peerId: string) => void;
};

type ParticipantRowProps = {
  name: string;
  isYou?: boolean;
  voiceJoined: boolean;
  micMuted: boolean;
  sharing?: boolean;
  shareStarting?: boolean;
  focused?: boolean;
  onWatch?: () => void;
};

function ParticipantRow({
  name,
  isYou = false,
  voiceJoined,
  micMuted,
  sharing = false,
  shareStarting = false,
  focused = false,
  onWatch,
}: ParticipantRowProps) {
  const voiceLabel = !voiceJoined ? "No voice" : micMuted ? "Mic muted" : "Mic on";
  const voiceColor = !voiceJoined || micMuted ? colors.muted : colors.acid;
  const shareLabel = shareStarting ? "Starting" : sharing ? "Sharing" : "Not sharing";
  const shareColor = sharing ? colors.acid : colors.muted;

  return (
    <View style={styles.participantRow}>
      <View style={styles.participantCopy}>
        <View style={styles.nameLine}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.name}>
            {name}
          </Text>
          {isYou ? <Text style={styles.youBadge}>YOU</Text> : null}
        </View>
        <View style={styles.statusLine}>
          {!isYou ? (
            <View style={styles.statusBadge}>
              {sharing ? (
                <ScreenIcon size={14} color={shareColor} />
              ) : (
                <ScreenOffIcon size={14} color={shareColor} />
              )}
              <Text style={[styles.statusText, { color: shareColor }]}>{shareLabel}</Text>
            </View>
          ) : null}
          <View style={styles.statusBadge}>
            {voiceJoined && !micMuted ? (
              <MicrophoneIcon size={14} color={voiceColor} />
            ) : (
              <MicrophoneMutedIcon size={14} color={voiceColor} />
            )}
            <Text style={[styles.statusText, { color: voiceColor }]}>{voiceLabel}</Text>
          </View>
        </View>
      </View>

      {onWatch ? (
        <Pressable
          style={({ pressed }) => [
            styles.watchButton,
            focused && styles.watchButtonSelected,
            shareStarting && styles.buttonDisabled,
            pressed && !shareStarting && styles.pressed,
          ]}
          onPress={onWatch}
          disabled={shareStarting}
          accessibilityRole="button"
          accessibilityLabel={focused ? `Watching ${name}'s screen` : `Watch ${name}'s screen`}
          accessibilityHint="Switches the screen shown in the room."
          accessibilityState={{ selected: focused, disabled: shareStarting, busy: shareStarting }}
        >
          <ScreenIcon size={16} color={focused ? colors.acidInk : colors.paper} />
          <Text style={[styles.watchText, focused && styles.watchTextSelected]}>
            {shareStarting ? "Starting" : focused ? "Watching" : "Watch"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ParticipantsList({
  participants,
  name,
  voiceState,
  visible,
  onClose,
  focusedPeerId,
  onWatchPeer,
}: ParticipantsListProps) {
  const [dismissedLocally, setDismissedLocally] = useState(false);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isSidebar = width >= 700;
  const isVisible = (visible ?? true) && !dismissedLocally;

  useEffect(() => {
    if (visible === false) setDismissedLocally(false);
  }, [visible]);

  const close = () => {
    setDismissedLocally(true);
    onClose?.();
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType={isSidebar ? "fade" : "slide"}
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessible={false}
        />
        <View
          style={[
            styles.panel,
            isSidebar
              ? [
                  styles.sidebar,
                  {
                    top: Math.max(insets.top, 16),
                    bottom: Math.max(insets.bottom, 16),
                    width: Math.min(width * 0.48, 420),
                  },
                ]
              : [
                  styles.sheet,
                  {
                    maxHeight: Math.min(height * 0.78, 600),
                    paddingBottom: Math.max(insets.bottom, 16),
                  },
                ],
          ]}
          accessibilityViewIsModal
        >
          {!isSidebar ? <View style={styles.handle} /> : null}
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.title}>Participants</Text>
              <Text style={styles.subtitle}>
                {participants.length + 1} {participants.length === 0 ? "person" : "people"} in this room
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close participants"
            >
              <CloseIcon size={20} color={colors.paper} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            <ParticipantRow
              name={name}
              isYou
              voiceJoined={voiceState?.voiceJoined ?? true}
              micMuted={voiceState?.micMuted ?? true}
            />
            {participants.map((participant) => {
              const shareStarting = participant.sharing && !participant.streamId;
              const canWatch = participant.sharing && Boolean(onWatchPeer);
              const focused = participant.id === focusedPeerId;

              return (
                <ParticipantRow
                  key={participant.id}
                  name={participant.name}
                  voiceJoined={participant.voiceJoined}
                  micMuted={participant.micMuted}
                  sharing={participant.sharing}
                  shareStarting={shareStarting}
                  focused={focused}
                  onWatch={canWatch ? () => {
                    onWatchPeer?.(participant.id);
                    if (!shareStarting) close();
                  } : undefined}
                />
              );
            })}
            {participants.length === 0 ? (
              <Text style={styles.emptyText}>You’re the only person here right now.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "flex-end",
  },
  panel: {
    overflow: "hidden",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    ...controlShadow,
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderBottomWidth: 0,
    paddingTop: 10,
    paddingHorizontal: 18,
  },
  sidebar: {
    position: "absolute",
    right: 0,
    borderTopLeftRadius: radii.sheet,
    borderBottomLeftRadius: radii.sheet,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    alignSelf: "center",
    marginBottom: 10,
    borderRadius: radii.round,
    backgroundColor: colors.lineStrong,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.paper, fontSize: 18, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  closeButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceControl,
  },
  list: { flexShrink: 1 },
  listContent: { paddingTop: 6, paddingBottom: 8 },
  participantRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  participantCopy: { flex: 1, minWidth: 0, gap: 7 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1, color: colors.paper, fontSize: 14, fontWeight: "700" },
  youBadge: {
    ...technicalText,
    color: colors.acid,
    fontSize: 8,
    lineHeight: 15,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: "rgba(201,255,66,0.32)",
    borderRadius: radii.control,
  },
  statusLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusText: { fontSize: 11, fontWeight: "600" },
  watchButton: {
    minWidth: 94,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceControl,
  },
  watchButtonSelected: {
    backgroundColor: colors.acid,
    borderColor: colors.acid,
  },
  watchText: { color: colors.paper, fontSize: 12, fontWeight: "700" },
  watchTextSelected: { color: colors.acidInk },
  buttonDisabled: { opacity: 0.52 },
  pressed: { opacity: 0.72 },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 24 },
});
