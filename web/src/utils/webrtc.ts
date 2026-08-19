export async function logSelectedIceRoute(peerId: string, connection: RTCPeerConnection) {
  const stats = await connection.getStats();

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
    console.warn(`[${peerId}] No selected ICE pair found`);
    return;
  }

  const localCandidate = stats.get(selectedPair.localCandidateId) as any;
  const remoteCandidate = stats.get(selectedPair.remoteCandidateId) as any;

  const localType = localCandidate?.candidateType;
  const remoteType = remoteCandidate?.candidateType;

  const usingTurn = localType === "relay" || remoteType === "relay";

  const usingStun =
    !usingTurn && (localType === "srflx" || remoteType === "srflx");

  const route = usingTurn
    ? "TURN relay"
    : usingStun
      ? "Direct P2P via STUN"
      : "Direct P2P";

  console.log(`[${peerId}] ICE ROUTE: ${route}`, {
    localType,
    remoteType,
    protocol: localCandidate?.protocol,
    localAddress: localCandidate?.address,
    remoteAddress: remoteCandidate?.address,
    rtt: selectedPair.currentRoundTripTime,
  });
}

export type InboundVideoSample = {
  timestamp: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number;
};

export type InboundVideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
};

export async function getInboundVideoSample(
  connection: RTCPeerConnection,
): Promise<InboundVideoSample | null> {
  const stats = await connection.getStats();

  let sample: InboundVideoSample | null = null;

  stats.forEach((report) => {
    const rtp = report as any;

    if (
      report.type === "inbound-rtp" &&
      rtp.kind === "video"
    ) {
      sample = {
        timestamp: Date.now(),
        width: typeof rtp.frameWidth === "number" ? rtp.frameWidth : null,
        height: typeof rtp.frameHeight === "number" ? rtp.frameHeight : null,
        fps: typeof rtp.framesPerSecond === "number" ? rtp.framesPerSecond : null,
        bytes: typeof rtp.bytesReceived === "number" ? rtp.bytesReceived : 0,
      };
    }
  });

  return sample;
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