import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { formatBitrate, formatResolution } from "@golive/core";
import type { ShareSettings, SocketStatus, VoiceState } from "@golive/core";
import {
  MicrophoneIcon,
  MicrophoneMutedIcon,
  ScreenIcon,
  StopIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from "./icons";
import { colors, controlShadow, radii, technicalText } from "../theme";

type ControlDockProps = {
  name: string;
  status: SocketStatus;
  localStream: unknown;
  isStartingShare: boolean;
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
  activeSettings,
  voiceState,
  deafened,
  onOpenSettings,
  onStopShare,
  onSetMicrophoneMuted,
  onToggleDeafen,
}: ControlDockProps) {
  const { width } = useWindowDimensions();
  const canShare = status === "connected" && !localStream && !isStartingShare;
  const microphoneDisabled = status !== "connected" || voiceState.requestingMicrophone;
  const showIdentity = width >= 640;
  const showVoiceLabels = width >= 640;
  const showShareLabel = width >= 520;
  const showPrivacy = width >= 960;

  return (
    <View style={[styles.dock, width < 400 && styles.dockCompact]}>
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
              <MicrophoneMutedIcon size={20} color={colors.muted} />
            ) : (
              <MicrophoneIcon size={20} color={colors.paper} />
            )}
            {showVoiceLabels ? (
              <Text style={styles.voiceButtonText}>
                {voiceState.requestingMicrophone ? "Starting…" : voiceState.micMuted ? "Unmute" : "Mute"}
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
            accessibilityState={{ selected: deafened }}
          >
            {deafened ? (
              <VolumeMutedIcon size={20} color={colors.muted} />
            ) : (
              <VolumeIcon size={20} color={colors.paper} />
            )}
            {showVoiceLabels ? (
              <Text style={styles.voiceButtonText}>{deafened ? "Undeafen" : "Deafen"}</Text>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.shareControl}>
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
              style={({ pressed }) => [
                styles.stopButton,
                !showShareLabel && styles.iconOnlyButton,
                pressed && styles.pressed,
              ]}
              onPress={onStopShare}
              accessibilityRole="button"
              accessibilityLabel="Stop sharing"
              accessibilityState={{ selected: true }}
            >
              <StopIcon size={16} color={colors.redText} />
              {showShareLabel ? <Text style={styles.stopText}>Stop sharing</Text> : null}
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.shareButton,
              !showShareLabel && styles.iconOnlyButton,
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
              <ActivityIndicator size="small" color={colors.acidInk} />
            ) : (
              <ScreenIcon size={20} color={colors.acidInk} />
            )}
            {showShareLabel ? (
              <Text style={styles.shareText}>{isStartingShare ? "Choosing a screen…" : "Share screen"}</Text>
            ) : null}
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
    minHeight: 72,
    backgroundColor: "rgba(28,28,25,0.97)",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    ...controlShadow,
  },
  dockCompact: { paddingHorizontal: 10 },
  identity: { flexDirection: "row", alignItems: "center", gap: 16, minWidth: 0 },
  youChip: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  avatar: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#34342f", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#c2c1b8", fontSize: 13, fontWeight: "700" },
  youCopy: { flexShrink: 1, minWidth: 0 },
  youLabel: { ...technicalText, color: "#98988f", fontSize: 8, marginBottom: 3 },
  youName: { color: colors.paper, fontSize: 12, fontWeight: "700" },
  voiceControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  voiceButton: {
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: 10,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceControl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  voiceButtonCompact: { minWidth: 48, width: 48, paddingHorizontal: 0 },
  voiceButtonActive: { borderWidth: 1, borderColor: "rgba(201,255,66,0.55)" },
  voiceButtonMuted: { borderWidth: 1, borderColor: colors.lineStrong },
  voiceButtonText: { color: colors.paper, fontSize: 11, fontWeight: "700" },
  shareControl: { flexGrow: 1, flexShrink: 1, minWidth: 48, alignItems: "center", paddingHorizontal: 4 },
  sharingState: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  qualityBadge: { minHeight: 40, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.control, backgroundColor: colors.surfaceControl, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  qualityText: { color: "#c2c1b8", fontFamily: "monospace", fontSize: 10 },
  qualityDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.acid },
  shareButton: { minHeight: 48, minWidth: 148, paddingHorizontal: 16, borderRadius: radii.control, backgroundColor: colors.acid, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  shareText: { color: colors.acidInk, fontSize: 13, fontWeight: "800" },
  stopButton: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: radii.control, backgroundColor: "#31201d", borderWidth: 1, borderColor: "#69342d", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  iconOnlyButton: { width: 48, minWidth: 48, paddingHorizontal: 0 },
  stopText: { color: colors.redText, fontSize: 13, fontWeight: "800" },
  privacyNote: { flexDirection: "row", alignItems: "center", gap: 9, maxWidth: "26%" },
  privacyIcon: { width: 36, height: 36, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  privacyArrow: { color: colors.muted, fontSize: 13 },
  privacyTitle: { color: "#c2c1b8", fontSize: 10, fontWeight: "700", marginBottom: 2 },
  privacyText: { color: colors.muted, fontSize: 10 },
  buttonDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.76 },
});
