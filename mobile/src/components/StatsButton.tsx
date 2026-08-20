import { Pressable, StyleSheet, Text } from "react-native";

type StatsButtonProps = {
  statsEnabled: boolean;
  onToggle: () => void;
};

export function StatsButton({ statsEnabled, onToggle }: StatsButtonProps) {
  return (
    <Pressable
      style={[styles.button, !statsEnabled && styles.buttonInactive]}
      onPress={onToggle}
    >
      <Text style={[styles.text, !statsEnabled && styles.textInactive]}>Stats</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: "rgba(16,16,14,0.88)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttonInactive: {
    opacity: 0.55,
  },
  text: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
  },
  textInactive: {
    color: "#ffb13b",
  },
});