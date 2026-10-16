import SliderBase, { type SliderProps } from "@react-native-community/slider";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

const Slider = SliderBase as unknown as React.ComponentType<SliderProps>;

type RoomVoiceVolumeControlProps = {
  volume: number;
  onVolumeChange: (volume: number) => void;
};

export function RoomVoiceVolumeControl({ volume, onVolumeChange }: RoomVoiceVolumeControlProps) {
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={styles.label}>Room voice volume</Text>
        <Text style={styles.value}>{Math.round(volume * 100)}%</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={1}
        step={0.05}
        value={volume}
        onValueChange={onVolumeChange}
        minimumTrackTintColor={colors.acid}
        maximumTrackTintColor="#45453f"
        thumbTintColor={colors.acid}
        accessibilityLabel="Room voice volume"
        accessibilityHint="Adjusts the overall volume of other participants’ voices."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { color: colors.paper, fontSize: 12, fontWeight: "600" },
  value: { color: colors.acid, fontFamily: "monospace", fontSize: 11 },
  slider: { width: "100%", height: 40 },
});
