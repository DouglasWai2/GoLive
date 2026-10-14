import { useEffect, useState } from "react";

export const LOCAL_SPEAKER_ID = "__local_voice__";

function sameSpeakers(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

export function useSpeakingPeers(
  localStream: MediaStream | null,
  remoteStreams: Record<string, MediaStream>,
): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const streams = [
      ...(localStream ? [[LOCAL_SPEAKER_ID, localStream] as const] : []),
      ...Object.entries(remoteStreams),
    ];
    const AudioContextClass = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (streams.length === 0 || !AudioContextClass) {
      setSpeaking((current) => current.size ? new Set() : current);
      return;
    }

    let context: AudioContext;
    try {
      context = new AudioContextClass();
    } catch {
      return;
    }

    const sources: MediaStreamAudioSourceNode[] = [];
    const monitors = streams.flatMap(([id, stream]) => {
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended") return [];

      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        sources.push(source);
        return [{ id, track, analyser, samples: new Uint8Array(analyser.fftSize), lastHeard: 0 }];
      } catch {
        return [];
      }
    });

    if (monitors.length === 0) {
      setSpeaking((current) => current.size ? new Set() : current);
      void context.close().catch(() => {});
      return;
    }

    const resume = () => {
      if (context.state === "suspended") void context.resume().catch(() => {});
    };
    resume();
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);

    const poll = () => {
      if (document.hidden || context.state !== "running") return;
      const now = performance.now();
      const next = new Set<string>();

      for (const monitor of monitors) {
        if (monitor.track.readyState !== "live" || !monitor.track.enabled || monitor.track.muted) continue;
        monitor.analyser.getByteTimeDomainData(monitor.samples);
        let power = 0;
        for (const sample of monitor.samples) {
          const amplitude = (sample - 128) / 128;
          power += amplitude * amplitude;
        }
        if (Math.sqrt(power / monitor.samples.length) > 0.025) monitor.lastHeard = now;
        if (now - monitor.lastHeard < 280) next.add(monitor.id);
      }

      setSpeaking((current) => sameSpeakers(current, next) ? current : next);
    };

    const interval = window.setInterval(poll, 120);
    const onVisibilityChange = () => {
      if (document.hidden) setSpeaking((current) => current.size ? new Set() : current);
      else resume();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const source of sources) source.disconnect();
      void context.close().catch(() => {});
    };
  }, [localStream, remoteStreams]);

  return speaking;
}
