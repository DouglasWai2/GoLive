import { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { Peer } from "@golive/core";
import { colors, radii, technicalText } from "../theme";

type ParticipantsListProps = {
  participants: Peer[];
  name: string;
  voiceState?: {
    micMuted: boolean;
    voiceJoined: boolean;
  };
};

type ParticipantProps = {
  name: string;
  isYou?: boolean;
  showDivider: boolean;
  voiceJoined?: boolean;
  micMuted?: boolean;
};

function Participant({ name, isYou = false, showDivider, voiceJoined = false, micMuted = true }: ParticipantProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      speed: 32,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  };

  const voiceStatus = voiceJoined
    ? micMuted
      ? { text: "Muted", color: colors.muted }
      : { text: "Mic on", color: colors.acid }
    : { text: "No voice", color: colors.dim };

  return (
    <Pressable
      onPress={() => {}}
      onPressIn={() => animateTo(0.97)}
      onPressOut={() => animateTo(1)}
    >
      <Animated.View
        style={[
          styles.row,
          showDivider && styles.rowDivider,
          { transform: [{ scale }] },
        ]}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.name, isYou && styles.localName]}
        >
          {name}
        </Text>
        {isYou ? (
          <>
            <Text style={styles.youBadge}>You</Text>
            <Text style={[styles.voiceBadge, { color: voiceStatus.color }]}>{voiceStatus.text}</Text>
          </>
        ) : (
          <Text style={[styles.voiceBadge, { color: voiceStatus.color }]}>{voiceStatus.text}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

export function ParticipantsList({ participants, name, voiceState }: ParticipantsListProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.column}>
        <View style={styles.rowHeader}>
          <Text style={styles.headerLabel}>Participants</Text>
          <Text style={styles.value}>{participants.length + 1}</Text>
        </View>
        <Participant
          name={name}
          isYou
          showDivider={participants.length > 0}
          voiceJoined={voiceState?.voiceJoined ?? true}
          micMuted={voiceState?.micMuted ?? true}
        />
        {participants.map((participant, index) => (
          <Participant
            key={participant.id}
            name={participant.name}
            showDivider={index < participants.length - 1}
            voiceJoined={participant.voiceJoined ?? false}
            micMuted={participant.micMuted ?? true}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    right: 0,
    top: 40,
    gap: 10,
    zIndex: 999,
    width: "100%",
    minWidth: 200,
    backgroundColor: "rgba(16,16,14,0.94)",
    borderWidth: 1,
    borderColor: "#3b3b36",
    borderRadius: radii.overlay,
    overflow: "hidden",
  },
  column: {
    flexDirection: "column",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginHorizontal: 5,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#3b3b36",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#3b3b36",
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  headerLabel: {
    ...technicalText,
    color: colors.muted,
    fontSize: 11,
  },
  name: {
    ...technicalText,
    minWidth: 0,
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
  localName: {
    color: colors.paper,
  },
  youBadge: {
    ...technicalText,
    flexShrink: 0,
    paddingHorizontal: 4,
    color: colors.acid,
    borderWidth: 1,
    borderColor: "rgba(201,255,66,0.32)",
    borderRadius: radii.control,
    fontSize: 7,
    lineHeight: 12,
  },
  value: {
    color: colors.acid,
    fontFamily: "monospace",
    fontSize: 13,
  },
  voiceBadge: {
    ...technicalText,
    flexShrink: 0,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderRadius: radii.control,
    fontSize: 7,
    lineHeight: 12,
  },
});
