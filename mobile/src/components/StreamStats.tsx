import { StyleSheet, Text, View } from "react-native";
import { formatCodec, formatConnectionRoute, formatKbps } from "@golive/core";
import type { RemoteVideoStats } from "@golive/core";

type StreamStatsProps = {
  stats: RemoteVideoStats;
};

export function StreamStats({ stats }: StreamStatsProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.item}>
        <Text style={styles.label}>Resolution</Text>
        <Text style={styles.value}>
          {stats.width}×{stats.height}
        </Text>
      </View>
      <View style={styles.item}>
        <Text style={styles.label}>Frame rate</Text>
        <Text style={styles.value}>{stats.fps} fps</Text>
      </View>
      <View style={styles.item}>
        <Text style={styles.label}>Bitrate</Text>
        <Text style={styles.value}>{formatKbps(stats.bitrateKbps)}</Text>
      </View>
      <View style={styles.item}>
        <Text style={styles.label}>Connection</Text>
        <Text style={styles.value}>{formatConnectionRoute(stats.route)}</Text>
      </View>
      <View style={styles.item}>
        <Text style={styles.label}>Encoder</Text>
        <Text style={styles.value}>{formatCodec(stats.codec)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    left: 12,
    bottom: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    maxWidth: "100%",
    backgroundColor: "rgba(16,16,14,0.9)",
    borderWidth: 1,
    borderColor: "#3b3b36",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  item: {
    gap: 2,
  },
  label: {
    color: "#9c9c93",
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  value: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
  },
});