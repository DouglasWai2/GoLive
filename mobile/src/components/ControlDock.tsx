import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { formatBitrate, formatResolution } from "@golive/core";
import type { Peer, ShareSettings, SocketStatus } from "@golive/core";
import { ScreenIcon } from "./icons";
import { colors, controlShadow, radii, technicalText } from "../theme";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: unknown;
  isStartingShare: boolean;
  peers: Peer[];
  activeSettings: ShareSettings | null;
  onOpenSettings: () => void;
  onStopShare: () => void;
};

export function ControlDock({
  name,
  status,
  localStream,
  isStartingShare,
  peers,
  activeSettings,
  onOpenSettings,
  onStopShare,
}: ControlDockProps) {
  const { width } = useWindowDimensions();
  const activeSharer = peers.find((peer) => peer.sharing);
  const canShare = status === "connected" && !activeSharer && !localStream && !isStartingShare;
  const showIdentity = width >= 430;
  const showPrivacy = width >= 700;

  return (
    <View style={styles.dock}>
      {showIdentity ? (
        <View style={styles.youChip}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.youCopy}>
            <Text style={styles.youLabel}>You</Text>
            <Text style={styles.youName} numberOfLines={1}>{name}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.shareControl}>
        {localStream ? (
          <View style={styles.sharingState}>
            {activeSettings && width >= 520 ? (
              <View style={styles.qualityBadge}>
                <Text style={styles.qualityText}>
                  {formatResolution(activeSettings.width, activeSettings.height)}
                </Text>
                <View style={styles.qualityDot} />
                <Text style={styles.qualityText}>{activeSettings.frameRate} fps</Text>
                <View style={styles.qualityDot} />
                <Text style={styles.qualityText}>{formatBitrate(activeSettings.maxBitrate)}</Text>
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
              onPress={onStopShare}
              accessibilityRole="button"
              accessibilityLabel="Stop sharing"
            >
              <View style={styles.stopSquare} />
              <Text style={styles.stopText}>Stop sharing</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.shareButton,
              !canShare && styles.buttonDisabled,
              pressed && canShare && styles.pressed,
            ]}
            disabled={!canShare}
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel={activeSharer ? "Screen sharing is in use" : "Share screen"}
          >
            <ScreenIcon size={20} color={colors.acidInk} />
            <Text style={styles.shareText}>
              {isStartingShare
                ? "Choosing a screen..."
                : activeSharer
                  ? "Screen in use"
                  : "Share screen"}
            </Text>
          </Pressable>
        )}
      </View>

      {showPrivacy ? (
        <View style={styles.privacyNote}>
          <View style={styles.privacyIcon}><Text style={styles.privacyArrow}>↗</Text></View>
          <View>
            <Text style={styles.privacyTitle}>Direct connection</Text>
            <Text style={styles.privacyText}>Media never touches our server</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    zIndex: 10,
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 70,
    backgroundColor: "rgba(28,28,25,0.97)",
    borderWidth: 1,
    borderColor: "#3b3b36",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...controlShadow,
  },
  youChip: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: "25%" },
  avatar: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#34342f", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#c2c1b8", fontSize: 13, fontWeight: "700" },
  youCopy: { flexShrink: 1 },
  youLabel: { ...technicalText, color: "#66665f", fontSize: 8, marginBottom: 3 },
  youName: { color: colors.paper, fontSize: 12, fontWeight: "700" },
  shareControl: { flexGrow: 1, alignItems: "center", paddingHorizontal: 8 },
  sharingState: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  qualityBadge: { minHeight: 34, borderWidth: 1, borderColor: "#3b3b36", borderRadius: radii.control, backgroundColor: colors.surfaceControl, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  qualityText: { color: "#b5b5ad", fontFamily: "monospace", fontSize: 9 },
  qualityDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.acid },
  shareButton: { minHeight: 48, minWidth: 164, paddingHorizontal: 20, borderRadius: radii.control, backgroundColor: colors.acid, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  shareText: { color: colors.acidInk, fontSize: 14, fontWeight: "800" },
  stopButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: radii.control, backgroundColor: "#31201d", borderWidth: 1, borderColor: "#69342d", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  stopSquare: { width: 10, height: 10, backgroundColor: colors.red },
  stopText: { color: "#ff9386", fontSize: 14, fontWeight: "800" },
  privacyNote: { flexDirection: "row", alignItems: "center", gap: 9, maxWidth: "26%" },
  privacyIcon: { width: 33, height: 33, borderWidth: 1, borderColor: "#41413c", borderRadius: 17, alignItems: "center", justifyContent: "center" },
  privacyArrow: { color: colors.muted, fontSize: 13 },
  privacyTitle: { color: "#aaa9a0", fontSize: 10, fontWeight: "700", marginBottom: 2 },
  privacyText: { color: "#87877f", fontSize: 9 },
  buttonDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.76 },
});
