import { useCallback, useEffect, useRef, useState } from "react";

type VoiceAudioProps = {
  streams: Record<string, MediaStream>;
  deafened: boolean;
};

type RemoteVoiceProps = {
  peerId: string;
  stream: MediaStream;
  deafened: boolean;
  onBlocked: (peerId: string, blocked: boolean) => void;
};

function RemoteVoice({ peerId, stream, deafened, onBlocked }: RemoteVoiceProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let active = true;
    audio.srcObject = stream;
    audio.muted = deafened;

    if (!deafened) {
      void audio.play().then(
        () => active && onBlocked(peerId, false),
        () => active && onBlocked(peerId, true),
      );
    }

    return () => {
      active = false;
      audio.srcObject = null;
      onBlocked(peerId, false);
    };
  }, [deafened, onBlocked, peerId, stream]);

  return <audio ref={audioRef} autoPlay playsInline data-voice-peer={peerId} />;
}

export function VoiceAudio({ streams, deafened }: VoiceAudioProps) {
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
