import type { RemoteVideoStats } from "../../types";
import { formatCodec, formatConnectionRoute, formatKbps } from "@golive/core";

type StreamStatsProps = {
  stats: RemoteVideoStats;
};

export function StreamStats({ stats }: StreamStatsProps) {
  return (
    <div className="stream-stats">
      <div className="stream-stats-item">
        <small>Resolution</small>
        <strong>{stats.width}×{stats.height}</strong>
      </div>
      <div className="stream-stats-item">
        <small>Frame rate</small>
        <strong>{stats.fps} fps</strong>
      </div>
      <div className="stream-stats-item">
        <small>Bitrate</small>
        <strong>{formatKbps(stats.bitrateKbps)}</strong>
      </div>
      <div className="stream-stats-item">
        <small>Connection</small>
        <strong>{formatConnectionRoute(stats.route)}</strong>
      </div>
      <div className="stream-stats-item">
        <small>Encoder</small>
        <strong>{formatCodec(stats.codec)}</strong>
      </div>
    </div>
  );
}