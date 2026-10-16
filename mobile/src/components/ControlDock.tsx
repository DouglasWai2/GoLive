import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { formatBitrate, formatResolution } from "@golive/core";
import type { ShareSettings, SocketStatus, VoiceState } from "@golive/core";
import {
  MicrophoneIcon,
  MicrophoneMutedIcon,
  PhoneOffIcon,
  ScreenIcon,
  ScreenOffIcon,
  UsersIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from "./icons";
import { colors, controlShadow, radii, technicalText } from "../theme";

type ControlDockProps = {
  name: string;
  participantsCount: number;
  participantsOpen: boolean;
  status: SocketStatus;
  localStream: unknown;
  isStartingShare: boolean;
  activeSettings: ShareSettings | null;
  voiceState: VoiceState;
  deafened: boolean;
  onOpenParticipants: () => void;
  onOpenSettings: () => void;
  onStopShare: () => void;
  onSetMicrophoneMuted: (muted: boolean) => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
};

export function ControlDock({
  name,
  participantsCount,
  participantsOpen,
  status,
  localStream,
  isStartingShare,
  activeSettings,
  voiceState,
  deafened,
  onOpenParticipants,
  onOpenSettings,
  onStopShare,
  onSetMicrophoneMuted,
  onToggleDeafen,
  onLeave,
}: ControlDockProps) {
  const { width } = useWindowDimensions();
  const canShare = status === "connected" && !localStream && !isStartingShare;
  const microphoneDisabled = status !== "connected" || voiceState.requestingMicrophone;
  const showIdentity = width >= 640;
  const showPrivacy = width >= 960;

  return (
    <View style={[styles.dock, width < 400 && styles.dockCompact]}>
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

      <View style={styles.actions} accessibilityRole="toolbar" accessibilityLabel="Call controls">
        <Pressable
          style={({ pressed }) => [styles.button, styles.participantsButton, participantsOpen && styles.buttonSelected, pressed && styles.pressed]}
          onPress={onOpenParticipants}
          accessibilityRole="button"
          accessibilityLabel={`${participantsOpen ? "Close" : "Show"} people in the call, ${participantsCount} ${participantsCount === 1 ? "participant" : "participants"}`}
          accessibilityState={{ expanded: participantsOpen }}
        >
          <UsersIcon size={18} color={participantsOpen ? colors.acid : colors.paper} />
          <View pointerEvents="none" style={styles.participantBadge}>
            <Text style={styles.participantBadgeText}>{participantsCount}</Text>
          </View>
        </Pressable>

        <View style={styles.voiceControls}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              voiceState.micMuted ? styles.voiceButtonMuted : styles.voiceButtonActive,
              microphoneDisabled && styles.buttonDisabled,
              pressed && !microphoneDisabled && styles.pressed,
            ]}
            disabled={microphoneDisabled}
            onPress={() => onSetMicrophoneMuted(!voiceState.micMuted)}
            accessibilityRole="button"
            accessibilityLabel={voiceState.requestingMicrophone
              ? "Starting microphone"
              : voiceState.micMuted ? "Unmute microphone" : "Mute microphone"}
            accessibilityHint="Changes whether other people can hear your microphone."
            accessibilityState={{
              selected: !voiceState.micMuted,
              disabled: microphoneDisabled,
              busy: voiceState.requestingMicrophone,
            }}
          >
            {voiceState.requestingMicrophone ? (
              <ActivityIndicator size="small" color={colors.paper} />
            ) : voiceState.micMuted ? (
              <MicrophoneMutedIcon size={18} color={colors.redText} />
            ) : (
              <MicrophoneIcon size={18} color={colors.acid} />
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              deafened && styles.voiceButtonMuted,
              pressed && styles.pressed,
            ]}
            onPress={onToggleDeafen}
            accessibilityRole="button"
            accessibilityLabel={deafened ? "Hear room voice" : "Deafen room voice"}
            accessibilityState={{ selected: deafened }}
          >
            {deafened ? (
              <VolumeMutedIcon size={18} color={colors.redText} />
            ) : (
              <VolumeIcon size={18} color={colors.paper} />
            )}
          </Pressable>
        </View>

        {localStream ? (
          <View style={styles.sharingState}>
            {activeSettings && width >= 820 ? (
              <View style={styles.qualityBadge} accessibilityLabel="Screen share quality">
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
              style={({ pressed }) => [styles.button, styles.stopButton, pressed && styles.pressed]}
              onPress={onStopShare}
              accessibilityRole="button"
              accessibilityLabel="Stop sharing your screen"
              accessibilityState={{ selected: true }}
            >
              <ScreenOffIcon size={20} color={colors.redText} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.shareButton,
              !canShare && styles.buttonDisabled,
              pressed && canShare && styles.pressed,
            ]}
            disabled={!canShare}
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel={isStartingShare ? "Choosing a screen" : "Share screen"}
            accessibilityHint={status === "connected" ? "Opens screen sharing options." : "Connect to the room before sharing."}
            accessibilityState={{ selected: false, disabled: !canShare, busy: isStartingShare }}
          >
            {isStartingShare ? (
              <ActivityIndicator size="small" color={colors.acid} />
            ) : (
              <ScreenIcon size={20} color={colors.acid} />
            )}
          </Pressable>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]}
        onPress={onLeave}
        accessibilityRole="button"
        accessibilityLabel="Leave room"
      >
        <PhoneOffIcon size={22} color={colors.paper} />
      </Pressable>

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
    minHeight: 72,
    backgroundColor: "rgba(28,28,25,0.97)",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    ...controlShadow,
  },
  dockCompact: { left: 8, right: 8, paddingHorizontal: 8, gap: 8 },
  youChip: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  avatar: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#34342f", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#c2c1b8", fontSize: 13, fontWeight: "700" },
  youCopy: { flexShrink: 1, minWidth: 0 },
  youLabel: { ...technicalText, color: "#98988f", fontSize: 8, marginBottom: 3 },
  youName: { color: colors.paper, fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  voiceControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.round,
    backgroundColor: "#2c2c27",
    alignItems: "center",
    justifyContent: "center",
  },
  participantsButton: { position: "relative" },
  participantBadge: {
    position: "absolute",
    top: 1,
    right: 1,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: radii.round,
    backgroundColor: colors.acid,
    alignItems: "center",
    justifyContent: "center",
  },
  participantBadgeText: { color: colors.acidInk, fontFamily: "monospace", fontSize: 9, lineHeight: 11, fontWeight: "700" },
  voiceButtonActive: { borderWidth: 1, borderColor: "rgba(201,255,66,0.55)" },
  voiceButtonMuted: { borderWidth: 1, borderColor: "#874a40", backgroundColor: "#382723" },
  buttonSelected: { borderColor: "rgba(201,255,66,0.55)" },
  sharingState: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  qualityBadge: { minHeight: 40, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.control, backgroundColor: colors.surfaceControl, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  qualityText: { color: "#c2c1b8", fontFamily: "monospace", fontSize: 10 },
  qualityDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.acid },
  shareButton: { borderColor: "#454e32", backgroundColor: "#343b25" },
  stopButton: { borderColor: "#874a40", backgroundColor: "#382723" },
  leaveButton: { width: 52, height: 48, borderRadius: 22, backgroundColor: "#db3732", alignItems: "center", justifyContent: "center" },
  privacyNote: { flexDirection: "row", alignItems: "center", gap: 9, maxWidth: "26%" },
  privacyIcon: { width: 36, height: 36, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  privacyArrow: { color: colors.muted, fontSize: 13 },
  privacyTitle: { color: "#c2c1b8", fontSize: 10, fontWeight: "700", marginBottom: 2 },
  privacyText: { color: colors.muted, fontSize: 10 },
  buttonDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.76 },
});
