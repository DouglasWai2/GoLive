import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import SliderBase, { type SliderProps } from "@react-native-community/slider";
import { VolumeIcon, VolumeMutedIcon } from "./icons";
import { colors, controlShadow, radii, technicalText } from "../theme";

const Slider = SliderBase as unknown as React.ComponentType<SliderProps>;

type VolumeControlProps = {
  volume: number;
  muted: boolean;
  disabled?: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
};

export function VolumeControl({
  volume,
  muted,
  disabled = false,
  onVolumeChange,
  onToggleMute,
}: VolumeControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.wrap, open && styles.wrapOpen]}>
      {open ? (
        <View style={styles.popover}>
          {disabled ? (
            <Text style={styles.unavailableText}>No shared audio</Text>
          ) : (
            <>
              <View style={styles.popoverRow}>
                <Pressable
                  style={styles.muteButton}
                  onPress={onToggleMute}
                  accessibilityRole="button"
                  accessibilityLabel={muted ? "Unmute stream" : "Mute stream"}
                >
                  {muted ? (
                    <VolumeMutedIcon size={17} color={colors.redText} />
                  ) : (
                    <VolumeIcon size={17} color={colors.acid} />
                  )}
                  <Text style={[styles.muteText, muted && styles.muteTextMuted]}>
                    {muted ? "Unmute" : "Mute"}
                  </Text>
                </Pressable>
                <Text style={styles.levelText}>{muted ? "0%" : `${Math.round(volume * 100)}%`}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1}
                step={0.05}
                value={volume}
                onSlidingStart={() => {
                  if (muted) onToggleMute();
                }}
                onValueChange={onVolumeChange}
                minimumTrackTintColor={colors.acid}
                maximumTrackTintColor="#3d3d36"
                thumbTintColor={colors.acid}
                accessibilityLabel="Stream volume"
              />
            </>
          )}
        </View>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.button, muted && styles.buttonMuted, disabled && styles.buttonDisabled, pressed && styles.pressed]}
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={disabled ? "No shared audio" : muted ? "Muted, open volume controls" : "Open volume controls"}
        accessibilityState={{ expanded: open }}
      >
        {muted ? (
          <VolumeMutedIcon color={colors.redText} />
        ) : (
          <VolumeIcon color="#b5b5ad" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", justifyContent: "flex-end" },
  wrapOpen: { width: 220, height: 132 },
  button: { width: 44, height: 44, backgroundColor: "rgba(16,16,14,0.9)", borderWidth: 1, borderColor: "#3d3d36", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  buttonMuted: { opacity: 0.72 },
  buttonDisabled: { opacity: 0.38 },
  pressed: { opacity: 0.6 },
  popover: { position: "absolute", right: 0, bottom: 52, width: 220, backgroundColor: "rgba(16,16,14,0.98)", borderWidth: 1, borderColor: "#3b3b36", borderRadius: radii.overlay, paddingHorizontal: 12, paddingVertical: 10, zIndex: 30, ...controlShadow },
  popoverRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  muteButton: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7 },
  muteText: { color: colors.acid, fontSize: 12, fontWeight: "700" },
  muteTextMuted: { color: colors.redText },
  levelText: { ...technicalText, color: colors.muted, fontSize: 9 },
  unavailableText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  slider: { width: "100%", height: 32 },
});
