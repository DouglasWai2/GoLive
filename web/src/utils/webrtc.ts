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