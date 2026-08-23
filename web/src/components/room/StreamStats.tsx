import type { ReactNode } from "react";
import type { OutboundVideoStats, RemoteVideoStats } from "../../types";
import { formatCodec, formatConnectionRoute, formatKbps } from "@golive/core";

type RemoteStreamStatsProps = {
  stats: RemoteVideoStats;
  outbound?: never;
};

export type OutboundStatsEntry = {
  peerId: string;
  peerName: string;
  stats: OutboundVideoStats;
};

type OutboundStreamStatsProps = {
  stats?: never;
  outbound: OutboundStatsEntry[];
};

type StreamStatsProps = RemoteStreamStatsProps | OutboundStreamStatsProps;

const value = (current: number | null, suffix = "") =>
  current === null ? "—" : `${Math.round(current)}${suffix}`;

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stream-stats-item">
      <small>{label}</small>
      <strong>{children}</strong>
    </div>
  );
}

export function StreamStats(props: StreamStatsProps) {
  if (props.outbound) {
    return (
      <div className="stream-stats outbound-stream-stats">
        {props.outbound.map(({ peerId, peerName, stats }) => (
          <div className="outbound-stream-stats-row" key={peerId}>
            <Stat label="Sending to">{peerName}</Stat>
            <Stat label="Resolution">
              {stats.width !== null && stats.height !== null
                ? `${stats.width}×${stats.height}`
                : "—"}
            </Stat>
            <Stat label="Frame rate">{value(stats.fps, " fps")}</Stat>
            <Stat label="Send bitrate">{formatKbps(stats.bitrateKbps)}</Stat>
            <Stat label="Available">
              {stats.availableOutgoingBitrateKbps === null
                ? "—"
                : formatKbps(stats.availableOutgoingBitrateKbps)}
            </Stat>
            <Stat label="Limited by">{stats.qualityLimitationReason ?? "—"}</Stat>
            <Stat label="RTT">{value(stats.rttMs, " ms")}</Stat>
            <Stat label="Connection">{formatConnectionRoute(stats.route)}</Stat>
            <Stat label="Codec">{formatCodec(stats.codec)}</Stat>
          </div>
        ))}
      </div>
    );
  }

  const { stats } = props;

  return (
    <div className="stream-stats">
      <Stat label="Resolution">
        {stats.width !== null && stats.height !== null
          ? `${stats.width}×${stats.height}`
          : "—"}
      </Stat>
      <Stat label="Frame rate">{value(stats.fps, " fps")}</Stat>
      <Stat label="Bitrate">{formatKbps(stats.bitrateKbps)}</Stat>
      <Stat label="Packet loss">
        {stats.packetLossPercent === null
          ? "—"
          : `${stats.packetLossPercent.toFixed(1)}%`}
      </Stat>
      <Stat label="Jitter">{value(stats.jitterMs, " ms")}</Stat>
      <Stat label="Decoded / dropped">
        {stats.framesDecoded === null ? "—" : stats.framesDecoded} / {stats.framesDropped ?? "—"}
      </Stat>
      <Stat label="RTT">{value(stats.rttMs, " ms")}</Stat>
      <Stat label="Connection">{formatConnectionRoute(stats.route)}</Stat>
      <Stat label="Codec">{formatCodec(stats.codec)}</Stat>
    </div>
  );
}
