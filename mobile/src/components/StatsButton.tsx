import { Pressable, StyleSheet } from "react-native";
import { StatsIcon } from "./icons";
import { colors, radii } from "../theme";

type StatsButtonProps = {
  statsEnabled: boolean;
  onToggle: () => void;
};

export function StatsButton({ statsEnabled, onToggle }: StatsButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        statsEnabled && styles.buttonActive,
        pressed && styles.pressed,
      ]}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityLabel="Stream statistics"
      accessibilityState={{ checked: statsEnabled }}
    >
      <StatsIcon color={statsEnabled ? colors.acid : "#b5b5ad"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    backgroundColor: "rgba(16,16,14,0.9)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonActive: { borderColor: colors.acid },
  pressed: { opacity: 0.68 },
});
