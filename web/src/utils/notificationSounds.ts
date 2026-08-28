export type NotificationSound =
  | "share-start"
  | "share-stop"
  | "peer-join"
  | "peer-leave"
  | "mic-mute"
  | "mic-unmute"
  | "deafen"
  | "undeafen";

type AudioContextConstructor = new () => AudioContext;
type Tone = readonly [frequency: number, delay: number, duration: number, volume: number];

const tones: Record<NotificationSound, readonly Tone[]> = {
  "share-start": [
    [100, 0, 0.1, 0.13],
    [220, 0.05, 0.11, 0.17],
    [440, 0.1, 0.16, 0.17],
    [660, 0.16, 0.16, 0.17],
  ],
  "share-stop": [
    [620, 0, 0.1, 0.13],
    [370, 0.1, 0.17, 0.16],
  ],
  "peer-join": [
    [300, 0, 0.08, 0.12],
    [450, 0.08, 0.08, 0.14],
    [620, 0.16, 0.13, 0.15],
   
  ],
  "peer-leave": [
    [400, 0, 0.08, 0.12],
    [280, 0.08, 0.08, 0.14],
    [240, 0.16, 0.13, 0.15],
  ],
  "mic-mute": [
    [700, 0, 0.07, 0.11],
    [400, 0.07, 0.12, 0.14],
  ],
  "mic-unmute": [
    [200, 0, 0.07, 0.11],
    [900, 0.07, 0.12, 0.14],
  ],
  deafen: [
    [540, 0, 0.08, 0.11],
    [360, 0.08, 0.14, 0.14],
  ],
  undeafen: [
    [520, 0, 0.08, 0.11],
    [700, 0.08, 0.13, 0.14],
  ],
};

let context: AudioContext | null = null;
const activeOscillators = new Set<OscillatorNode>();

function isRunning(audioContext: AudioContext): boolean {
  return audioContext.state === "running";
}

function getAudioContext(): AudioContext | null {
  if (context?.state === "closed") context = null;
  if (context) return context;
  if (typeof window === "undefined") return null;

  const AudioContextClass = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

  if (!AudioContextClass) return null;

  try {
    context = new AudioContextClass();
    return context;
  } catch {
    return null;
  }
}

function scheduleSound(audioContext: AudioContext, sound: NotificationSound) {
  const start = audioContext.currentTime + 0.01;

  for (const [frequency, delay, duration, volume] of tones[sound]) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const toneStart = start + delay;
    const toneEnd = toneStart + duration;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(volume, toneStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    activeOscillators.add(oscillator);
    oscillator.addEventListener("ended", () => {
      activeOscillators.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.01);
  }
}

export async function primeNotificationAudio(): Promise<boolean> {
  const audioContext = getAudioContext();
  if (!audioContext) return false;
  if (audioContext.state === "running") return true;
  if (audioContext.state === "closed") return false;

  try {
    await audioContext.resume();
    return isRunning(audioContext);
  } catch {
    // Notification sounds are optional when browser autoplay policy blocks audio.
    return false;
  }
}

export function playNotificationSound(sound: NotificationSound): void {
  const audioContext = getAudioContext();
  if (!audioContext) return;

  if (audioContext.state === "running") {
    scheduleSound(audioContext, sound);
    return;
  }

  if (audioContext.state === "closed") return;

  const requestedAt = performance.now();
  void audioContext.resume().then(() => {
    // Autoplay-blocked resume promises can settle on a much later gesture.
    // Drop stale cues instead of replaying a burst of old room events.
    if (isRunning(audioContext) && performance.now() - requestedAt < 1000) {
      scheduleSound(audioContext, sound);
    }
  }).catch(() => {
    // The next user gesture will retry activation through App's priming listeners.
  });
}
