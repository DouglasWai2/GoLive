import { ScrollView, StyleSheet, Text, View } from "react-native";
import { formatCodec, formatConnectionRoute, formatKbps } from "@golive/core";
import type { OutboundVideoStats, RemoteVideoStats } from "@golive/core";
import { colors, radii, technicalText } from "../theme";

export type OutboundStatsEntry = {
  peerId: string;
  peerName: string;
  stats: OutboundVideoStats;
};

type StreamStatsProps =
  | { stats: RemoteVideoStats; outbound?: never; fullscreen?: boolean }
  | { stats?: never; outbound: OutboundStatsEntry[]; fullscreen?: boolean };

const value = (current: number | null, suffix = "") =>
  current === null ? "—" : `${Math.round(current)}${suffix}`;

function Stat({ label, value: current }: { label: string; value: string | number }) {
  return (
    <View style={styles.item}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{current}</Text>
    </View>
  );
}

export function StreamStats(props: StreamStatsProps) {
  if (props.outbound) {
    return (
      <View style={[styles.panel, styles.panelOutbound, props.fullscreen && styles.panelFullscreen]}>
        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.outboundContent}>
          {props.outbound.map(({ peerId, peerName, stats }) => (
            <View style={styles.row} key={peerId}>
            <Stat label="Sending to" value={peerName} />
            <Stat
              label="Resolution"
              value={
                stats.width !== null && stats.height !== null
                  ? `${stats.width}×${stats.height}`
                  : "—"
              }
            />
            <Stat label="Frame rate" value={value(stats.fps, " fps")} />
            <Stat label="Send bitrate" value={formatKbps(stats.bitrateKbps)} />
            <Stat
              label="Available"
              value={
                stats.availableOutgoingBitrateKbps === null
                  ? "—"
                  : formatKbps(stats.availableOutgoingBitrateKbps)
              }
            />
            <Stat label="Limited by" value={stats.qualityLimitationReason ?? "—"} />
            <Stat label="RTT" value={value(stats.rttMs, " ms")} />
            <Stat label="Connection" value={formatConnectionRoute(stats.route)} />
            <Stat label="Codec" value={formatCodec(stats.codec)} />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  const { stats } = props;

  return (
    <View pointerEvents="none" style={[styles.panel, props.fullscreen && styles.panelFullscreen]}>
      <View style={styles.row}>
        <Stat
          label="Resolution"
          value={
            stats.width !== null && stats.height !== null
              ? `${stats.width}×${stats.height}`
              : "—"
          }
        />
        <Stat label="Frame rate" value={value(stats.fps, " fps")} />
        <Stat label="Bitrate" value={formatKbps(stats.bitrateKbps)} />
        <Stat
          label="Packet loss"
          value={
            stats.packetLossPercent === null
              ? "—"
              : `${stats.packetLossPercent.toFixed(1)}%`
          }
        />
        <Stat label="Jitter" value={value(stats.jitterMs, " ms")} />
        <Stat
          label="Decoded / dropped"
          value={`${stats.framesDecoded ?? "—"} / ${stats.framesDropped ?? "—"}`}
        />
        <Stat label="RTT" value={value(stats.rttMs, " ms")} />
        <Stat label="Connection" value={formatConnectionRoute(stats.route)} />
        <Stat label="Codec" value={formatCodec(stats.codec)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 56,
    gap: 10,
    backgroundColor: "rgba(16,16,14,0.94)",
    borderWidth: 1,
    borderColor: "#3b3b36",
    borderRadius: radii.overlay,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  panelFullscreen: { bottom: 76, left: 18, right: 18, paddingHorizontal: 18, paddingVertical: 14 },
  panelOutbound: { maxHeight: "72%" },
  outboundContent: { gap: 10 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  item: {
    gap: 2,
  },
  label: {
    ...technicalText,
    color: colors.muted,
    fontSize: 8,
  },
  value: {
    color: colors.paper,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "600",
  },
});
