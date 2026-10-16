import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import SliderBase, { type SliderProps } from "@react-native-community/slider";
import { VolumeIcon, VolumeMutedIcon } from "./icons";
import { colors, radii } from "../theme";

const Slider = SliderBase as unknown as React.ComponentType<SliderProps>;

type VolumeControlProps = {
  volume: number;
  muted: boolean;
  disabled?: boolean;
  volumeLabel?: string;
  muteLabel?: string;
  unmuteLabel?: string;
  disabledLabel?: string;
  sliderStyle?: StyleProp<ViewStyle>;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
};

export function VolumeControl({
  volume,
  muted,
  disabled = false,
  volumeLabel = "Stream volume",
  muteLabel = "Mute stream",
  unmuteLabel = "Unmute stream",
  disabledLabel = "No shared audio",
  sliderStyle,
  onVolumeChange,
  onToggleMute,
}: VolumeControlProps) {
  const actionLabel = disabled ? disabledLabel : muted ? unmuteLabel : muteLabel;
  const level = muted || disabled ? 0 : volume;

  return (
    <View style={[styles.wrap, disabled && styles.wrapDisabled]}>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={onToggleMute}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ selected: muted, disabled }}
      >
        {muted ? (
          <VolumeMutedIcon color={colors.redText} />
        ) : (
          <VolumeIcon color="#b5b5ad" />
        )}
      </Pressable>
      <Slider
        style={[styles.slider, sliderStyle]}
        minimumValue={0}
        maximumValue={1}
        step={0.05}
        value={level}
        disabled={disabled}
        onSlidingStart={() => {
          if (muted) onToggleMute();
        }}
        onValueChange={onVolumeChange}
        minimumTrackTintColor={muted || disabled ? "#6e6e66" : colors.acid}
        maximumTrackTintColor="#45453f"
        thumbTintColor={muted || disabled ? "#98988f" : colors.acid}
        accessibilityLabel={disabled ? disabledLabel : volumeLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 44, flexDirection: "row", alignItems: "center", paddingRight: 8, backgroundColor: "rgba(16,16,14,0.9)", borderWidth: 1, borderColor: "#3d3d36", borderRadius: radii.control },
  wrapDisabled: { opacity: 0.45 },
  button: { width: 44, height: 42, borderRightWidth: 1, borderRightColor: "#3d3d36", alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  slider: { width: 92, height: 42 },
});
