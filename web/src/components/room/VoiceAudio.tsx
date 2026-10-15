import { useCallback, useEffect, useRef, useState } from "react";
import type { VoicePlaybackSettings } from "../../types";

const DEFAULT_VOICE_SETTINGS: VoicePlaybackSettings = { volume: 1, muted: false };

type VoiceAudioProps = {
  streams: Record<string, MediaStream>;
  deafened: boolean;
  globalVolume: number;
  settings: Record<string, VoicePlaybackSettings>;
};

type RemoteVoiceProps = {
  peerId: string;
  stream: MediaStream;
  deafened: boolean;
  globalVolume: number;
  settings: VoicePlaybackSettings;
  onBlocked: (peerId: string, blocked: boolean) => void;
};

function RemoteVoice({ peerId, stream, deafened, globalVolume, settings, onBlocked }: RemoteVoiceProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.srcObject = stream;

    return () => {
      audio.srcObject = null;
      onBlocked(peerId, false);
    };
  }, [onBlocked, peerId, stream]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = settings.volume * globalVolume;
    audio.muted = deafened || settings.muted;
    audio.dataset.individuallyMuted = String(settings.muted);

    if (deafened || settings.muted) {
      onBlocked(peerId, false);
    }
  }, [deafened, globalVolume, onBlocked, peerId, settings.muted, settings.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || deafened || settings.muted) return;
    if (!audio.paused) return;

    let active = true;
    void audio.play().then(
      () => active && onBlocked(peerId, false),
      () => active && onBlocked(peerId, true),
    );

    return () => {
      active = false;
    };
  }, [deafened, onBlocked, peerId, settings.muted, stream]);

  return <audio ref={audioRef} autoPlay playsInline data-voice-peer={peerId} />;
}

export function VoiceAudio({ streams, deafened, globalVolume, settings }: VoiceAudioProps) {
  const [blockedPeers, setBlockedPeers] = useState<Set<string>>(new Set());

  const setBlocked = useCallback((peerId: string, blocked: boolean) => {
    setBlockedPeers((current) => {
      const next = new Set(current);
      if (blocked) next.add(peerId);
      else next.delete(peerId);
      return next;
    });
  }, []);

  const enableAudio = async () => {
    const attempted = new Map<string, HTMLAudioElement>();
    const failedPeers = new Set<string>();

    await Promise.all([...document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]")].map(async (audio) => {
      const peerId = audio.dataset.voicePeer;
      if (!peerId) return;
      if (audio.dataset.individuallyMuted === "true") return;

      attempted.set(peerId, audio);
      audio.muted = false;
      try {
        await audio.play();
      } catch {
        failedPeers.add(peerId);
      }
    }));

    setBlockedPeers((current) => {
      const next = new Set(current);
      for (const [peerId, audio] of attempted) {
        if (!document.contains(audio) || !failedPeers.has(peerId)) next.delete(peerId);
        else next.add(peerId);
      }
      return next;
    });
  };

  return (
    <div className="voice-audio" aria-live="polite">
      {Object.entries(streams).map(([peerId, stream]) => (
        <RemoteVoice
          key={peerId}
          peerId={peerId}
          stream={stream}
          deafened={deafened}
          globalVolume={globalVolume}
          settings={settings[peerId] ?? DEFAULT_VOICE_SETTINGS}
          onBlocked={setBlocked}
        />
      ))}
      {!deafened && blockedPeers.size > 0 && (
        <button type="button" className="audio-playback-action voice-playback-action" onClick={() => void enableAudio()}>
          Enable room voice
        </button>
      )}
    </div>
  );
}
