import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { formatBitrate, formatResolution } from "@golive/core";
import type { Peer, ShareSettings, SocketStatus, VoiceState } from "@golive/core";
import { MicrophoneIcon, MicrophoneMutedIcon, ScreenIcon, VolumeIcon, VolumeMutedIcon } from "./icons";
import { colors, controlShadow, radii, technicalText } from "../theme";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: unknown;
  isStartingShare: boolean;
  peers: Peer[];
  activeSettings: ShareSettings | null;
  voiceState: VoiceState;
  deafened: boolean;
  onOpenSettings: () => void;
  onStopShare: () => void;
  onSetMicrophoneMuted: (muted: boolean) => void;
  onToggleDeafen: () => void;
};

export function ControlDock({
  name,
  status,
  localStream,
  isStartingShare,
  peers,
  activeSettings,
  voiceState,
  deafened,
  onOpenSettings,
  onStopShare,
  onSetMicrophoneMuted,
  onToggleDeafen,
}: ControlDockProps) {
  const { width } = useWindowDimensions();
  const activeSharer = peers.find((peer) => peer.sharing);
  const canShare = status === "connected" && !activeSharer && !localStream && !isStartingShare;
  const showIdentity = width >= 600;
  const showVoiceLabels = width >= 620;
  const showPrivacy = width >= 700;

  return (
    <View style={styles.dock}>
      <View style={styles.identity}>
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
        <View style={styles.voiceControls}>
          <Pressable
            style={({ pressed }) => [
              styles.voiceButton,
              !showVoiceLabels && styles.voiceButtonCompact,
              voiceState.micMuted ? styles.voiceButtonMuted : styles.voiceButtonActive,
              voiceState.requestingMicrophone && styles.voiceButtonBusy,
              pressed && !voiceState.requestingMicrophone && styles.pressed,
            ]}
            disabled={status !== "connected" || voiceState.requestingMicrophone}
            onPress={() => onSetMicrophoneMuted(!voiceState.micMuted)}
            accessibilityRole="button"
            accessibilityLabel={voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {voiceState.micMuted ? <MicrophoneMutedIcon size={20} color={colors.muted} /> : <MicrophoneIcon size={20} color={colors.paper} />}
            {showVoiceLabels ? (
              <Text style={styles.voiceButtonText}>
                {voiceState.requestingMicrophone ? "Starting..." : voiceState.micMuted ? "Unmute" : "Mute"}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.voiceButton,
              !showVoiceLabels && styles.voiceButtonCompact,
              deafened ? styles.voiceButtonMuted : styles.voiceButtonActive,
              pressed && styles.pressed,
            ]}
            onPress={onToggleDeafen}
            accessibilityRole="button"
            accessibilityLabel={deafened ? "Hear room voice" : "Deafen room voice"}
          >
            {deafened ? <VolumeMutedIcon size={20} color={colors.muted} /> : <VolumeIcon size={20} color={colors.paper} />}
            {showVoiceLabels ? (
              <Text style={styles.voiceButtonText}>
                {deafened ? "Undeafen" : "Deafen"}
                
              </Text>
            ) : null}
          </Pressable>
        </View>
      </View>

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
              width < 430 && styles.shareButtonCompact,
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
            <Text style={styles.privacyTitle}>Encrypted media</Text>
            <Text style={styles.privacyText}>Direct with relay fallback</Text>
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
  identity: { flexDirection: "row", alignItems: "center", gap: 16, minWidth: 0 },
  youChip: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#34342f", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#c2c1b8", fontSize: 13, fontWeight: "700" },
  youCopy: { flexShrink: 1 },
  youLabel: { ...technicalText, color: "#66665f", fontSize: 8, marginBottom: 3 },
  youName: { color: colors.paper, fontSize: 12, fontWeight: "700" },
  voiceControls: { flexDirection: "row", alignItems: "center", gap: 7 },
  voiceButton: {
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: 10,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceControl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  voiceButtonCompact: { minWidth: 44, width: 44, paddingHorizontal: 0 },
  voiceButtonActive: { borderWidth: 1, borderColor: "rgba(201,255,66,0.55)" },
  voiceButtonMuted: { borderWidth: 1, borderColor: "#3b3b36" },
  voiceButtonBusy: { opacity: 0.5 },
  voiceButtonText: { color: "white", fontSize: 11, fontWeight: "700" },
  shareControl: { flexGrow: 1, alignItems: "center", paddingHorizontal: 8 },
  sharingState: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  qualityBadge: { minHeight: 34, borderWidth: 1, borderColor: "#3b3b36", borderRadius: radii.control, backgroundColor: colors.surfaceControl, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  qualityText: { color: "#b5b5ad", fontFamily: "monospace", fontSize: 9 },
  qualityDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.acid },
  shareButton: { minHeight: 48, minWidth: 164, paddingHorizontal: 20, borderRadius: radii.control, backgroundColor: colors.acid, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  shareButtonCompact: { minWidth: 148, paddingHorizontal: 14 },
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
