import { statfs } from "node:fs/promises";
import os from "node:os";

type CpuTimes = {
  idle: number;
  total: number;
};

export type SystemMetricsSnapshot = {
  generatedAt: string;
  serverStartedAt: string;
  process: {
    uptimeSeconds: number;
    cpuPercent: number;
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
  };
  host: {
    hostname: string;
    platform: NodeJS.Platform;
    cpuCount: number;
    cpuPercent: number;
    loadAverage: [number, number, number];
    totalMemoryBytes: number;
    freeMemoryBytes: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
  } | null;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function percent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function hostCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }

  return { idle, total };
}

export class SystemMetricsService {
  private readonly serverStartedAt = new Date().toISOString();
  private previousProcessCpu = process.cpuUsage();
  private previousProcessSample = process.hrtime.bigint();
  private previousHostCpu = hostCpuTimes();

  async getSnapshot(): Promise<SystemMetricsSnapshot> {
    const currentProcessCpu = process.cpuUsage();
    const currentProcessSample = process.hrtime.bigint();
    const elapsedMicros = Number(currentProcessSample - this.previousProcessSample) / 1_000;
    const usedMicros = currentProcessCpu.user - this.previousProcessCpu.user
      + currentProcessCpu.system - this.previousProcessCpu.system;
    const cpuCount = Math.max(1, os.cpus().length);
    const processCpuPercent = percent(usedMicros, elapsedMicros * cpuCount);
    this.previousProcessCpu = currentProcessCpu;
    this.previousProcessSample = currentProcessSample;

    const currentHostCpu = hostCpuTimes();
    const hostTotalDelta = currentHostCpu.total - this.previousHostCpu.total;
    const hostIdleDelta = currentHostCpu.idle - this.previousHostCpu.idle;
    const hostCpuPercent = percent(hostTotalDelta - hostIdleDelta, hostTotalDelta);
    this.previousHostCpu = currentHostCpu;

    const memory = process.memoryUsage();
    const loadAverage = os.loadavg().map(finiteNonNegative) as [number, number, number];

    return {
      generatedAt: new Date().toISOString(),
      serverStartedAt: this.serverStartedAt,
      process: {
        uptimeSeconds: finiteNonNegative(process.uptime()),
        cpuPercent: processCpuPercent,
        rssBytes: finiteNonNegative(memory.rss),
        heapTotalBytes: finiteNonNegative(memory.heapTotal),
        heapUsedBytes: finiteNonNegative(memory.heapUsed),
        externalBytes: finiteNonNegative(memory.external),
      },
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        cpuCount,
        cpuPercent: hostCpuPercent,
        loadAverage,
        totalMemoryBytes: finiteNonNegative(os.totalmem()),
        freeMemoryBytes: finiteNonNegative(os.freemem()),
      },
      disk: await this.getFilesystemMetrics(),
    };
  }

  private async getFilesystemMetrics(): Promise<SystemMetricsSnapshot["disk"]> {
    const path = process.cwd();

    try {
      const stats = await statfs(path, { bigint: true });
      const totalBytes = Number(stats.blocks * stats.bsize);
      const freeBytes = Number(stats.bavail * stats.bsize);

      if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) return null;

      return {
        path,
        totalBytes: Math.max(0, totalBytes),
        freeBytes: Math.max(0, freeBytes),
        usedBytes: Math.max(0, totalBytes - freeBytes),
      };
    } catch {
      return null;
    }
  }
}
