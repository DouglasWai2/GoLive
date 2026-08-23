import type { RTCPeerConnection, RTCRtpSender, StatsReportLike } from "./types";

export type IceRoute = {
  route: "TURN relay" | "Direct P2P via STUN" | "Direct P2P";
  localType: string | null;
  remoteType: string | null;
  protocol: string | null;
  localAddress: string | null;
  remoteAddress: string | null;
  rtt: number | null;
  availableOutgoingBitrate: number | null;
};

type AnyStat = Record<string, unknown>;

function extractIceRoute(stats: StatsReportLike): IceRoute | null {
  let selectedPair: AnyStat | null = null;

  /*
   * Preferred modern method:
   * transport -> selectedCandidatePairId
   */
  stats.forEach((report) => {
    const current = report as AnyStat;

    if (
      current.type === "transport" &&
      typeof current.selectedCandidatePairId === "string"
    ) {
      selectedPair = stats.get(current.selectedCandidatePairId) ?? null;
    }
  });

  /*
   * Fallback for platforms where the transport
   * stat doesn't expose selectedCandidatePairId.
   */
  if (!selectedPair) {
    stats.forEach((report) => {
      const current = report as AnyStat;

      if (
        current.type === "candidate-pair" &&
        current.state === "succeeded" &&
        current.nominated
      ) {
        selectedPair = current;
      }
    });
  }

  if (!selectedPair) {
    return null;
  }

  const pair = selectedPair as AnyStat;

  const localCandidate =
    typeof pair.localCandidateId === "string"
      ? stats.get(pair.localCandidateId)
      : undefined;
  const remoteCandidate =
    typeof pair.remoteCandidateId === "string"
      ? stats.get(pair.remoteCandidateId)
      : undefined;

  const localType =
    typeof localCandidate?.candidateType === "string"
      ? localCandidate.candidateType
      : null;
  const remoteType =
    typeof remoteCandidate?.candidateType === "string"
      ? remoteCandidate.candidateType
      : null;

  const usingTurn = localType === "relay" || remoteType === "relay";

  const usingStun =
    !usingTurn && (localType === "srflx" || remoteType === "srflx");

  const route = usingTurn
    ? "TURN relay"
    : usingStun
      ? "Direct P2P via STUN"
      : "Direct P2P";

  return {
    route,
    localType,
    remoteType,
    protocol:
      typeof localCandidate?.protocol === "string"
        ? localCandidate.protocol
        : typeof pair.protocol === "string"
          ? pair.protocol
          : null,
    localAddress:
      typeof localCandidate?.address === "string"
        ? localCandidate.address
        : null,
    remoteAddress:
      typeof remoteCandidate?.address === "string"
        ? remoteCandidate.address
        : null,
    rtt:
      typeof pair.currentRoundTripTime === "number"
        ? (pair.currentRoundTripTime as number)
        : null,
    availableOutgoingBitrate:
      typeof pair.availableOutgoingBitrate === "number"
        ? (pair.availableOutgoingBitrate as number)
        : null,
  };
}

export async function getSelectedIceRoute(
  connection: RTCPeerConnection,
): Promise<IceRoute | null> {
  const stats = await connection.getStats();
  return extractIceRoute(stats);
}

export async function logSelectedIceRoute(
  peerId: string,
  connection: RTCPeerConnection,
) {
  const route = await getSelectedIceRoute(connection);

  if (!route) {
    console.warn(`[${peerId}] No selected ICE pair found`);
    return;
  }

  console.log(`[${peerId}] ICE ROUTE: ${route.route}`, {
    localType: route.localType,
    remoteType: route.remoteType,
    protocol: route.protocol,
    localAddress: route.localAddress,
    remoteAddress: route.remoteAddress,
    rtt: route.rtt,
    availableOutgoingBitrate: route.availableOutgoingBitrate,
  });
}

export type InboundVideoSample = {
  timestamp: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number;
  codecMimeType: string | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  jitter: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
};

export type InboundVideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  packetLossPercent: number | null;
};

export type OutboundVideoSample = {
  timestamp: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number;
  codecMimeType: string | null;
  framesEncoded: number | null;
  qualityLimitationReason: string | null;
};

export type ComputedOutboundVideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
};

export type PeerMediaStats = {
  inbound: InboundVideoSample | null;
  outbound: OutboundVideoSample | null;
  iceRoute: IceRoute | null;
};

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function codecMimeType(stats: StatsReportLike, codecId: unknown): string | null {
  if (typeof codecId !== "string") {
    return null;
  }

  const codecReport = stats.get(codecId);
  return typeof codecReport?.mimeType === "string" ? codecReport.mimeType : null;
}

function isRepairCodec(mimeType: string | null) {
  return mimeType !== null && /^video\/(?:rtx|red|ulpfec)$/i.test(mimeType);
}

function isVideoRtp(rtp: AnyStat, type: "inbound-rtp" | "outbound-rtp") {
  return (
    rtp.type === type &&
    (rtp.kind === "video" || rtp.mediaType === "video") &&
    !rtp.isRemote
  );
}

function extractInboundVideo(
  stats: StatsReportLike,
): InboundVideoSample | null {
  let sample: InboundVideoSample | null = null;

  stats.forEach((report) => {
    const rtp = report as AnyStat;

    if (isVideoRtp(rtp, "inbound-rtp")) {
      const mimeType = codecMimeType(stats, rtp.codecId);

      if (isRepairCodec(mimeType)) {
        return;
      }

      sample = {
        timestamp: numberValue(rtp.timestamp) ?? Date.now(),
        width: numberValue(rtp.frameWidth),
        height: numberValue(rtp.frameHeight),
        fps: numberValue(rtp.framesPerSecond),
        bytes: numberValue(rtp.bytesReceived) ?? 0,
        codecMimeType: mimeType,
        packetsReceived: numberValue(rtp.packetsReceived),
        packetsLost: numberValue(rtp.packetsLost),
        jitter: numberValue(rtp.jitter),
        framesDecoded: numberValue(rtp.framesDecoded),
        framesDropped: numberValue(rtp.framesDropped),
      };
    }
  });

  return sample;
}

function extractOutboundVideo(
  stats: StatsReportLike,
): OutboundVideoSample | null {
  let sample: OutboundVideoSample | null = null;

  stats.forEach((report) => {
    const rtp = report as AnyStat;

    if (isVideoRtp(rtp, "outbound-rtp")) {
      const mimeType = codecMimeType(stats, rtp.codecId);

      if (isRepairCodec(mimeType)) {
        return;
      }

      sample = {
        timestamp: numberValue(rtp.timestamp) ?? Date.now(),
        width: numberValue(rtp.frameWidth),
        height: numberValue(rtp.frameHeight),
        fps: numberValue(rtp.framesPerSecond),
        bytes: numberValue(rtp.bytesSent) ?? 0,
        codecMimeType: mimeType,
        framesEncoded: numberValue(rtp.framesEncoded),
        qualityLimitationReason:
          typeof rtp.qualityLimitationReason === "string"
            ? rtp.qualityLimitationReason
            : null,
      };
    }
  });

  return sample;
}

/*
 * One getStats() pass that returns both the received video
 * sample and the selected ICE route.
 */
export async function getPeerMediaStats(
  connection: RTCPeerConnection,
): Promise<PeerMediaStats> {
  const stats = await connection.getStats();

  return {
    inbound: extractInboundVideo(stats),
    outbound: extractOutboundVideo(stats),
    iceRoute: extractIceRoute(stats),
  };
}

function computeRate(
  current: number,
  previous: number,
  deltaSeconds: number,
  multiplier = 1,
): number | null {
  if (current < previous || deltaSeconds <= 0) {
    return null;
  }

  return ((current - previous) * multiplier) / deltaSeconds;
}

export function computeInboundVideoStats(
  sample: InboundVideoSample,
  previous: InboundVideoSample | null,
): InboundVideoStats {
  let bitrateKbps: number | null = null;
  let packetLossPercent: number | null = null;
  let fps = sample.fps;

  if (previous) {
    const deltaSeconds = (sample.timestamp - previous.timestamp) / 1000;
    const bitrate = computeRate(sample.bytes, previous.bytes, deltaSeconds, 8 / 1000);

    if (bitrate !== null) {
      bitrateKbps = bitrate;
    }

    if (fps === null && sample.framesDecoded !== null && previous.framesDecoded !== null) {
      fps = computeRate(sample.framesDecoded, previous.framesDecoded, deltaSeconds);
    }

    if (
      sample.packetsReceived !== null &&
      previous.packetsReceived !== null &&
      sample.packetsLost !== null &&
      previous.packetsLost !== null
    ) {
      const received = sample.packetsReceived - previous.packetsReceived;
      const lost = sample.packetsLost - previous.packetsLost;
      const total = received + lost;

      if (received >= 0 && lost >= 0 && total > 0) {
        packetLossPercent = (lost / total) * 100;
      }
    }
  }

  return {
    width: sample.width,
    height: sample.height,
    fps,
    bitrateKbps,
    packetLossPercent,
  };
}

export function computeOutboundVideoStats(
  sample: OutboundVideoSample,
  previous: OutboundVideoSample | null,
): ComputedOutboundVideoStats {
  let bitrateKbps: number | null = null;
  let fps = sample.fps;

  if (previous) {
    const deltaSeconds = (sample.timestamp - previous.timestamp) / 1000;
    bitrateKbps = computeRate(sample.bytes, previous.bytes, deltaSeconds, 8 / 1000);

    if (fps === null && sample.framesEncoded !== null && previous.framesEncoded !== null) {
      fps = computeRate(sample.framesEncoded, previous.framesEncoded, deltaSeconds);
    }
  }

  return {
    width: sample.width,
    height: sample.height,
    fps,
    bitrateKbps,
  };
}

export async function configureVideoSender(
  sender: RTCRtpSender,
  {
    maxBitrate,
    maxFramerate,
    scaleResolutionDownBy = 1,
  }: {
    maxBitrate: number;
    maxFramerate: number;
    scaleResolutionDownBy?: number;
  },
) {
  const parameters = sender.getParameters();

  if (!parameters.encodings?.length) {
    console.warn("Video sender has no encodings yet");
    return;
  }

  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = maxBitrate;
    encoding.maxFramerate = maxFramerate;
    encoding.scaleResolutionDownBy = scaleResolutionDownBy;
  }

  parameters.degradationPreference = "maintain-framerate";

  try {
    await sender.setParameters(parameters);
  } catch (caught) {
    console.warn(
      "Sender does not support maintain-framerate; applying encoding caps only",
      caught,
    );

    const fallback = sender.getParameters();

    if (!fallback.encodings?.length) {
      return;
    }

    for (const encoding of fallback.encodings) {
      encoding.maxBitrate = maxBitrate;
      encoding.maxFramerate = maxFramerate;
      encoding.scaleResolutionDownBy = scaleResolutionDownBy;
    }

    delete fallback.degradationPreference;
    await sender.setParameters(fallback);
  }
}
