import { notificationSoundDefinition } from "@golive/core";
import type { NotificationSound } from "@golive/core";

export type { NotificationSound } from "@golive/core";

type AudioContextConstructor = new () => AudioContext;

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
  const { attackDuration, gainFloor, sounds } = notificationSoundDefinition;

  for (const [frequency, delay, duration, volume] of sounds[sound]) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const toneStart = start + delay;
    const toneEnd = toneStart + duration;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    gain.gain.setValueAtTime(gainFloor, toneStart);
    gain.gain.exponentialRampToValueAtTime(volume, toneStart + Math.min(attackDuration, duration));
    gain.gain.exponentialRampToValueAtTime(gainFloor, toneEnd);

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
