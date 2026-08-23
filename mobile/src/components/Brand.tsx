import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

type BrandProps = {
  compact?: boolean;
};

export function Brand({ compact = false }: BrandProps) {
  return (
    <View
      style={styles.brand}
      accessible
      accessibilityRole="text"
      accessibilityLabel="GoLive"
    >
      <View style={[styles.mark, compact && styles.markCompact]}>
        <View style={styles.innerRing} />
        <View style={[styles.dot, compact && styles.dotCompact]} />
      </View>
      <Text style={[styles.wordmark, compact && styles.wordmarkCompact]}>GoLive</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  mark: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: "#696960",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  markCompact: {
    width: 25,
    height: 25,
    borderRadius: 13,
  },
  innerRing: {
    position: "absolute",
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderWidth: 1,
    borderColor: "#41413c",
    borderRadius: 999,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.acid,
    shadowColor: colors.acid,
    shadowOpacity: 0.5,
    shadowRadius: 7,
    elevation: 3,
  },
  dotCompact: {
    width: 7,
    height: 7,
  },
  wordmark: {
    color: colors.paper,
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.75,
  },
  wordmarkCompact: {
    fontSize: 17,
  },
});
