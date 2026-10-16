import type { ReactNode } from "react";
import type { OutboundVideoStats, RemoteVideoStats } from "../../types";
import { formatCodec, formatConnectionRoute, formatKbps } from "@golive/core";

type RemoteStreamStatsProps = {
  stats: RemoteVideoStats;
  outbound?: never;
};

type OutboundStreamStatsProps = {
  stats?: never;
  outbound: OutboundVideoStats[];
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
    const resolutions = props.outbound.flatMap(({ width, height }) =>
      width !== null && height !== null ? [{ width, height }] : [],
    );
    const lowestResolution = resolutions.reduce<{ width: number; height: number } | null>(
      (lowest, current) =>
        !lowest || current.width * current.height < lowest.width * lowest.height
          ? current
          : lowest,
      null,
    );
    const frameRates = props.outbound.flatMap(({ fps }) => fps === null ? [] : [fps]);
    const lowestFrameRate = frameRates.length > 0 ? Math.min(...frameRates) : null;
    const totalBitrateKbps = props.outbound.reduce((total, stats) => total + stats.bitrateKbps, 0);
    const codecs = [...new Set(
      props.outbound.flatMap(({ codec }) => codec === null ? [] : [formatCodec(codec)]),
    )];
    const codec = codecs.length === 0 ? "—" : codecs.length === 1 ? codecs[0] : "Mixed";

    return (
      <div className="stream-stats outbound-stream-stats">
        <div className="outbound-stream-stats-row">
          <Stat label="Min resolution">
            {lowestResolution ? `${lowestResolution.width}×${lowestResolution.height}` : "—"}
          </Stat>
          <Stat label="Min frame rate">{value(lowestFrameRate, " fps")}</Stat>
          <Stat label="Total bitrate">{formatKbps(totalBitrateKbps)}</Stat>
          <Stat label="Codec">{codec}</Stat>
        </div>
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
