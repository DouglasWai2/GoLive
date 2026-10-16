import { useEffect, useRef, useState } from "react";
import type { Peer, VoiceAudioLevels, VoiceState } from "@golive/core";

const SPEAKING_THRESHOLD = 0.025;
const SPEAKING_HOLD_MS = 280;
const POLL_INTERVAL_MS = 250;

function sameSpeakers(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

export function useSpeakingPeers(
  peers: Peer[],
  voiceState: VoiceState,
  getVoiceAudioLevels: () => Promise<VoiceAudioLevels>,
  enabled: boolean,
) {
  const [speakingPeerIds, setSpeakingPeerIds] = useState<Set<string>>(() => new Set());
  const lastHeardRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) {
      lastHeardRef.current.clear();
      setSpeakingPeerIds((current) => current.size ? new Set() : current);
      return;
    }

    let active = true;
    let polling = false;
    const peerVoiceStates = peers.map((peer) => ({
      id: peer.id,
      active: peer.voiceJoined && !peer.micMuted,
    }));
    const trackedIds = new Set([
      "__local_voice__",
      ...peerVoiceStates.filter((peer) => peer.active).map((peer) => peer.id),
    ]);
    for (const id of lastHeardRef.current.keys()) {
      if (!trackedIds.has(id)) lastHeardRef.current.delete(id);
    }

    const poll = async () => {
      if (!active || polling) return;
      polling = true;

      try {
        const levels = await getVoiceAudioLevels();
        if (!active) return;

        const now = Date.now();
        const next = new Set<string>();
        const lastHeard = lastHeardRef.current;

        if (voiceState.joined && !voiceState.micMuted) {
          if (levels.local > SPEAKING_THRESHOLD) lastHeard.set("__local_voice__", now);
          if (now - (lastHeard.get("__local_voice__") ?? 0) < SPEAKING_HOLD_MS) {
            next.add("__local_voice__");
          }
        } else {
          lastHeard.delete("__local_voice__");
        }

        for (const peer of peerVoiceStates) {
          if (!peer.active) {
            lastHeard.delete(peer.id);
            continue;
          }

          if ((levels.peers[peer.id] ?? 0) > SPEAKING_THRESHOLD) lastHeard.set(peer.id, now);
          if (now - (lastHeard.get(peer.id) ?? 0) < SPEAKING_HOLD_MS) next.add(peer.id);
        }

        setSpeakingPeerIds((current) => sameSpeakers(current, next) ? current : next);
      } catch {
        // Audio levels are best-effort and must not interrupt the call UI.
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [enabled, getVoiceAudioLevels, peers, voiceState.joined, voiceState.micMuted]);

  return speakingPeerIds;
}
