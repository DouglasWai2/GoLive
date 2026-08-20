import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Peer, SocketStatus } from "@golive/core";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: unknown;
  isStartingShare: boolean;
  peers: Peer[];
  onOpenSettings: () => void;
  onStopShare: () => void;
};

export function ControlDock({
  name,
  status,
  localStream,
  isStartingShare,
  peers,
  onOpenSettings,
  onStopShare,
}: ControlDockProps) {
  const activeSharer = peers.find((peer) => peer.sharing);
  const canShare =
    status === "connected" && !activeSharer && !localStream && !isStartingShare;

  return (
    <View style={styles.dock}>
      <View style={styles.youChip}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.youLabel}>YOU</Text>
          <Text style={styles.youName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>

      {localStream ? (
        <Pressable style={styles.stopButton} onPress={onStopShare}>
          <View style={styles.stopDot} />
          <Text style={styles.stopText}>Stop sharing</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.shareButton, !canShare && styles.shareButtonDisabled]}
          disabled={!canShare}
          onPress={onOpenSettings}
        >
          <Text style={styles.shareText}>
            {isStartingShare
              ? "Choosing a screen..."
              : activeSharer
                ? "Screen in use"
                : "Share screen"}
          </Text>
        </Pressable>
      )}

      <View style={styles.privacyNote}>
        <Text style={styles.privacyText}>Direct connection — media never touches our server</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#23231f",
    alignItems: "center",
    gap: 12,
  },
  youChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#2c2c26",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#f2f1ec",
    fontSize: 15,
    fontWeight: "700",
  },
  youLabel: {
    color: "#9c9c93",
    fontSize: 10,
    letterSpacing: 0.6,
  },
  youName: {
    color: "#f2f1ec",
    fontSize: 14,
    fontWeight: "600",
    maxWidth: 200,
  },
  shareButton: {
    alignSelf: "stretch",
    backgroundColor: "#ffb13b",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  shareButtonDisabled: {
    opacity: 0.5,
  },
  shareText: {
    color: "#17130a",
    fontSize: 16,
    fontWeight: "700",
  },
  stopButton: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#ff5544",
    borderRadius: 12,
    paddingVertical: 16,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ff5544",
  },
  stopText: {
    color: "#ff7766",
    fontSize: 16,
    fontWeight: "700",
  },
  privacyNote: {
    alignItems: "center",
  },
  privacyText: {
    color: "#6f6f68",
    fontSize: 12,
  },
});