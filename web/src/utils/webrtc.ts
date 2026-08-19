export type IceRoute = {
  route: "TURN relay" | "Direct P2P via STUN" | "Direct P2P";
  localType: string | null;
  remoteType: string | null;
  protocol: string | null;
  localAddress: string | null;
  remoteAddress: string | null;
  rtt: number | null;
};

function extractIceRoute(stats: RTCStatsReport): IceRoute | null {
  let selectedPair: any = null;

  /*
   * Preferred modern method:
   * transport -> selectedCandidatePairId
   */
  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      selectedPair = stats.get(report.selectedCandidatePairId);
    }
  });

  /*
   * Fallback for browsers where the transport
   * stat doesn't expose selectedCandidatePairId.
   */
  if (!selectedPair) {
    stats.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        report.state === "succeeded" &&
        report.nominated
      ) {
        selectedPair = report;
      }
    });
  }

  if (!selectedPair) {
    return null;
  }

  const localCandidate = stats.get(selectedPair.localCandidateId) as any;
  const remoteCandidate = stats.get(selectedPair.remoteCandidateId) as any;

  const localType = localCandidate?.candidateType ?? null;
  const remoteType = remoteCandidate?.candidateType ?? null;

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
    protocol: localCandidate?.protocol ?? null,
    localAddress: localCandidate?.address ?? null,
    remoteAddress: remoteCandidate?.address ?? null,
    rtt: typeof selectedPair.currentRoundTripTime === "number"
      ? selectedPair.currentRoundTripTime
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
  });
}

export type InboundVideoSample = {
  timestamp: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number;
  codecMimeType: string | null;
};

export type InboundVideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
};

export type PeerMediaStats = {
  inbound: InboundVideoSample | null;
  iceRoute: IceRoute | null;
};

function extractInboundVideo(stats: RTCStatsReport): InboundVideoSample | null {
  let sample: InboundVideoSample | null = null;

  stats.forEach((report) => {
    const rtp = report as any;

    if (
      report.type === "inbound-rtp" &&
      rtp.kind === "video"
    ) {
      let codecMimeType: string | null = null;

      if (typeof rtp.codecId === "string") {
        const codecReport = stats.get(rtp.codecId) as any;
        codecMimeType = typeof codecReport?.mimeType === "string"
          ? codecReport.mimeType
          : null;
      }

      sample = {
        timestamp: Date.now(),
        width: typeof rtp.frameWidth === "number" ? rtp.frameWidth : null,
        height: typeof rtp.frameHeight === "number" ? rtp.frameHeight : null,
        fps: typeof rtp.framesPerSecond === "number" ? rtp.framesPerSecond : null,
        bytes: typeof rtp.bytesReceived === "number" ? rtp.bytesReceived : 0,
        codecMimeType,
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
    iceRoute: extractIceRoute(stats),
  };
}

export function computeInboundVideoStats(
  sample: InboundVideoSample,
  previous: InboundVideoSample | null,
): InboundVideoStats {
  let bitrateKbps: number | null = null;

  if (previous && sample.bytes >= previous.bytes) {
    const deltaBytes = sample.bytes - previous.bytes;
    const deltaSeconds = (Date.now() - previous.timestamp) / 1000;

    if (deltaBytes > 0 && deltaSeconds > 0) {
      bitrateKbps = (deltaBytes * 8) / deltaSeconds / 1000;
    }
  }

  return {
    width: sample.width,
    height: sample.height,
    fps: sample.fps,
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

  if (!parameters.encodings.length) {
    console.warn("Video sender has no encodings yet");
    return;
  }

  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = maxBitrate;
    encoding.maxFramerate = maxFramerate;
    encoding.scaleResolutionDownBy = scaleResolutionDownBy;
  }

  await sender.setParameters(parameters);
}