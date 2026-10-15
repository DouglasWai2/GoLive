import type { MediaStream as CoreMediaStream, UserMediaConstraints } from "@golive/core";

export type MicrophoneAudioSettings = {
  gateStrength: number;
  sensitivity: number;
  automaticSensitivity: boolean;
};

export type MicrophoneAudioMeterReading = {
  levelDb: number;
  thresholdDb: number;
  gateOpen: boolean;
};

export type MicrophoneAudioMeterState = {
  status: "idle" | "listening" | "unavailable";
  reading: MicrophoneAudioMeterReading | null;
};

export const DEFAULT_MICROPHONE_AUDIO_SETTINGS: MicrophoneAudioSettings = {
  gateStrength: 35,
  sensitivity: 60,
  automaticSensitivity: false,
};

const SETTINGS_STORAGE_KEY = "golive-microphone-audio-v1";
const GATE_HYSTERESIS_DB = 4;
const GATE_HOLD_MS = 120;
const GATE_CLOSED_ATTENUATION_DB = 48;
const AUTO_NOISE_SAMPLE_INTERVAL_MS = 80;
const AUTO_NOISE_WINDOW_MS = 1600;
const AUTO_NOISE_PERCENTILE = 0.2;
const AUTO_NOISE_MARGIN_DB = 8;
const AUTO_THRESHOLD_MIN_DB = -61;
const AUTO_THRESHOLD_MAX_DB = -40;
const AUDIO_CONTEXT_START_TIMEOUT_MS = 2500;
const PRIMED_CONTEXT_TIMEOUT_MS = 30000;
export const MICROPHONE_METER_MIN_DB = -70;
export const MICROPHONE_METER_MAX_DB = -20;

type GateProcessor = {
  update: (settings: MicrophoneAudioSettings) => void;
  release: () => void;
};

const processors = new Set<GateProcessor>();
const processedStreams = new WeakMap<MediaStream, () => void>();
const meterListeners = new Set<(state: MicrophoneAudioMeterState) => void>();
let currentMeterState: MicrophoneAudioMeterState = { status: "idle", reading: null };
let primedAudioContext: AudioContext | null = null;
let primedAudioContextTimer: number | null = null;

function publishMicrophoneAudioMeter(state: MicrophoneAudioMeterState) {
  currentMeterState = state;
  for (const listener of meterListeners) {
    try {
      listener(state);
    } catch {
      // A UI observer must never interrupt the audio processing loop.
    }
  }
}

export function subscribeMicrophoneAudioMeter(
  listener: (state: MicrophoneAudioMeterState) => void,
): () => void {
  meterListeners.add(listener);
  listener(currentMeterState);
  return () => meterListeners.delete(listener);
}

export function getMicrophoneMeterPosition(levelDb: number): number {
  if (!Number.isFinite(levelDb)) return 0;
  const range = MICROPHONE_METER_MAX_DB - MICROPHONE_METER_MIN_DB;
  return Math.max(0, Math.min(100, ((levelDb - MICROPHONE_METER_MIN_DB) / range) * 100));
}

function clampSetting(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSettings(value: unknown): MicrophoneAudioSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MicrophoneAudioSettings>;
  const gateStrength = clampSetting(candidate.gateStrength);
  const sensitivity = clampSetting(candidate.sensitivity);
  if (gateStrength === null || sensitivity === null) return null;
  return {
    gateStrength,
    sensitivity,
    automaticSensitivity: candidate.automaticSensitivity === true,
  };
}

function readSavedSettings(): MicrophoneAudioSettings {
  if (typeof window === "undefined") return DEFAULT_MICROPHONE_AUDIO_SETTINGS;

  try {
    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return DEFAULT_MICROPHONE_AUDIO_SETTINGS;
    return normalizeSettings(JSON.parse(saved)) ?? DEFAULT_MICROPHONE_AUDIO_SETTINGS;
  } catch {
    return DEFAULT_MICROPHONE_AUDIO_SETTINGS;
  }
}

let currentSettings = readSavedSettings();

export function getMicrophoneAudioSettings(): MicrophoneAudioSettings {
  return currentSettings;
}

export function setMicrophoneAudioSettings(settings: MicrophoneAudioSettings) {
  currentSettings = normalizeSettings(settings) ?? DEFAULT_MICROPHONE_AUDIO_SETTINGS;

  for (const processor of processors) {
    processor.update(currentSettings);
  }

  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
  } catch {
    // Audio controls remain usable when browser storage is unavailable.
  }
}

export function getNoiseGateThresholdDb(sensitivity: number): number {
  const normalizedSensitivity = Math.max(0, Math.min(100, sensitivity));
  // Higher sensitivity lowers the threshold so quieter speech opens the gate.
  return -34 - normalizedSensitivity * 0.27;
}

export function getMicrophoneSensitivityFromThresholdDb(thresholdDb: number): number {
  const minThresholdDb = getNoiseGateThresholdDb(100);
  const maxThresholdDb = getNoiseGateThresholdDb(0);
  const clampedThresholdDb = Math.max(minThresholdDb, Math.min(maxThresholdDb, thresholdDb));
  return Math.round((maxThresholdDb - clampedThresholdDb) / (maxThresholdDb - minThresholdDb) * 100);
}

export function getAutomaticNoiseGateThresholdDb(noiseFloorDb: number): number {
  return Math.max(
    AUTO_THRESHOLD_MIN_DB,
    Math.min(AUTO_THRESHOLD_MAX_DB, noiseFloorDb + AUTO_NOISE_MARGIN_DB),
  );
}

export function getNoiseGateClosedGain(gateStrength: number): number {
  const normalizedStrength = Math.max(0, Math.min(100, gateStrength));
  if (normalizedStrength === 0) return 1;
  return 10 ** (-(normalizedStrength / 100 * GATE_CLOSED_ATTENUATION_DB) / 20);
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function createAudioContext(): AudioContext | null {
  const AudioContextClass = getAudioContextConstructor();
  if (!AudioContextClass) return null;

  try {
    return new AudioContextClass();
  } catch {
    return null;
  }
}

function clearPrimedAudioContextTimer() {
  if (primedAudioContextTimer === null || typeof window === "undefined") return;
  window.clearTimeout(primedAudioContextTimer);
  primedAudioContextTimer = null;
}

/** Create/resume the context directly from a user gesture before async capture. */
export function prepareMicrophoneAudioContext() {
  if (typeof window === "undefined") return;

  if (!primedAudioContext || primedAudioContext.state === "closed") {
    primedAudioContext = createAudioContext();
  }
  const context = primedAudioContext;
  if (!context) return;

  void context.resume().catch(() => {});
  clearPrimedAudioContextTimer();
  primedAudioContextTimer = window.setTimeout(() => {
    if (primedAudioContext !== context) return;
    primedAudioContext = null;
    primedAudioContextTimer = null;
    void context.close().catch(() => {});
  }, PRIMED_CONTEXT_TIMEOUT_MS);
}

function takePrimedAudioContext(): AudioContext | null {
  const context = primedAudioContext;
  primedAudioContext = null;
  clearPrimedAudioContextTimer();
  return context;
}

async function ensureAudioContextRunning(context: AudioContext) {
  if (context.state === "running") return;

  let timeout: number | null = null;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("Microphone audio processing did not start")),
          AUDIO_CONTEXT_START_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }

  if ((context.state as string) !== "running") {
    throw new Error("Microphone audio processing did not start");
  }
}

export function isMicrophoneAudioProcessingSupported(): boolean {
  const AudioContextClass = getAudioContextConstructor();
  return Boolean(
    AudioContextClass
    && typeof navigator !== "undefined"
    && typeof (
      AudioContextClass.prototype as unknown as { createMediaStreamDestination?: unknown }
    ).createMediaStreamDestination === "function",
  );
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

async function processMicrophoneStream(
  inputStream: MediaStream,
  context: AudioContext | null,
): Promise<MediaStream> {
  if (!context || !isMicrophoneAudioProcessingSupported()) {
    void context?.close().catch(() => {});
    publishMicrophoneAudioMeter({ status: "unavailable", reading: null });
    processedStreams.set(inputStream, () => {
      stopTracks(inputStream);
      if (processors.size === 0) publishMicrophoneAudioMeter({ status: "idle", reading: null });
    });
    return inputStream;
  }

  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let gate: GainNode | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let monitorTimer: number | null = null;
  let released = false;

  try {
    await ensureAudioContextRunning(context);
    source = context.createMediaStreamSource(inputStream);
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    gate = context.createGain();
    destination = context.createMediaStreamDestination();

    source.connect(analyser);
    analyser.connect(gate);
    gate.connect(destination);

    const outputStream = destination.stream;
    const outputTrack = outputStream.getAudioTracks()[0];
    if (!outputTrack) throw new Error("Processed microphone audio is unavailable");
    outputTrack.contentHint = "speech";

    const samples = new Float32Array(analyser.fftSize);
    let settings = currentSettings;
    let isGateOpen = true;
    let lastAboveThresholdAt = performance.now();
    let lastMeterPublishedAt = 0;
    let lastAutoNoiseSampleAt = 0;
    let automaticThresholdDb = getNoiseGateThresholdDb(settings.sensitivity);
    const autoNoiseSamples: Array<{ time: number; levelDb: number }> = [];

    const setGateOpen = (open: boolean) => {
      if (isGateOpen === open) return;
      isGateOpen = open;
      if (!context || !gate || context.state === "closed") return;

      const targetGain = open ? 1 : getNoiseGateClosedGain(settings.gateStrength);
      const timeConstant = open ? 0.004 : 0.045;
      gate.gain.cancelScheduledValues(context.currentTime);
      gate.gain.setTargetAtTime(targetGain, context.currentTime, timeConstant);
    };

    const updateGate = () => {
      if (!analyser || !gate || !context || context.state !== "running") return;

      analyser.getFloatTimeDomainData(samples);
      let power = 0;
      for (const sample of samples) power += sample * sample;
      const rms = Math.sqrt(power / samples.length);
      const levelDb = rms > 0 ? 20 * Math.log10(rms) : -90;
      const now = performance.now();
      let thresholdDb = getNoiseGateThresholdDb(settings.sensitivity);

      if (settings.automaticSensitivity) {
        if (now - lastAutoNoiseSampleAt >= AUTO_NOISE_SAMPLE_INTERVAL_MS) {
          lastAutoNoiseSampleAt = now;
          autoNoiseSamples.push({ time: now, levelDb });
          const oldestSample = autoNoiseSamples.findIndex(
            (sample) => sample.time >= now - AUTO_NOISE_WINDOW_MS,
          );
          if (oldestSample > 0) autoNoiseSamples.splice(0, oldestSample);

          const sortedLevels = autoNoiseSamples.map((sample) => sample.levelDb).sort((a, b) => a - b);
          const percentileIndex = Math.floor((sortedLevels.length - 1) * AUTO_NOISE_PERCENTILE);
          const noiseFloorDb = sortedLevels[percentileIndex] ?? levelDb;
          const targetThresholdDb = getAutomaticNoiseGateThresholdDb(noiseFloorDb);
          automaticThresholdDb += (targetThresholdDb - automaticThresholdDb) * 0.25;
        }
        thresholdDb = automaticThresholdDb;
      }

      if (settings.gateStrength === 0) {
        if (!isGateOpen) setGateOpen(true);
      } else if (!isGateOpen && levelDb >= thresholdDb) {
        lastAboveThresholdAt = now;
        setGateOpen(true);
      } else if (isGateOpen) {
        if (levelDb >= thresholdDb - GATE_HYSTERESIS_DB) {
          lastAboveThresholdAt = now;
        } else if (now - lastAboveThresholdAt >= GATE_HOLD_MS) {
          setGateOpen(false);
        }
      }

      if (now - lastMeterPublishedAt >= 50) {
        lastMeterPublishedAt = now;
        publishMicrophoneAudioMeter({
          status: "listening",
          reading: {
            levelDb,
            thresholdDb,
            gateOpen: settings.gateStrength === 0 || isGateOpen,
          },
        });
      }
    };

    const processor: GateProcessor = {
      update: (nextSettings) => {
        const wasAutomaticallyAdjusting = settings.automaticSensitivity;
        settings = nextSettings;

        if (!gate || !context || context.state === "closed") return;
        if (settings.automaticSensitivity !== wasAutomaticallyAdjusting) {
          autoNoiseSamples.length = 0;
          lastAutoNoiseSampleAt = 0;
          automaticThresholdDb = getNoiseGateThresholdDb(settings.sensitivity);
        }
        if (settings.gateStrength === 0) {
          isGateOpen = true;
          lastAboveThresholdAt = performance.now();
          const now = context.currentTime;
          gate.gain.cancelScheduledValues(now);
          gate.gain.setTargetAtTime(1, now, 0.004);
        } else {
          updateGate();
          if (!isGateOpen) {
            const now = context.currentTime;
            gate.gain.cancelScheduledValues(now);
            gate.gain.setTargetAtTime(getNoiseGateClosedGain(settings.gateStrength), now, 0.045);
          }
        }
      },
      release: () => {
        if (released) return;
        released = true;
        if (monitorTimer !== null) window.clearInterval(monitorTimer);
        processors.delete(processor);
        if (processors.size === 0) publishMicrophoneAudioMeter({ status: "idle", reading: null });
        stopTracks(outputStream);
        source?.disconnect();
        analyser?.disconnect();
        gate?.disconnect();
        destination?.disconnect();
        stopTracks(inputStream);
        void context?.close().catch(() => {});
      },
    };

    processors.add(processor);
    publishMicrophoneAudioMeter({ status: "listening", reading: null });
    monitorTimer = window.setInterval(updateGate, 12);
    processedStreams.set(outputStream, processor.release);
    return outputStream;
  } catch (error) {
    console.warn("Microphone audio processing could not start; using the unprocessed microphone track.", error);
    publishMicrophoneAudioMeter({ status: "unavailable", reading: null });
    if (monitorTimer !== null) window.clearInterval(monitorTimer);
    if (destination) stopTracks(destination.stream);
    source?.disconnect();
    analyser?.disconnect();
    gate?.disconnect();
    destination?.disconnect();
    void context?.close().catch(() => {});
    processedStreams.set(inputStream, () => {
      stopTracks(inputStream);
      if (processors.size === 0) publishMicrophoneAudioMeter({ status: "idle", reading: null });
    });
    return inputStream;
  }
}

export async function captureProcessedMicrophone(
  constraints: UserMediaConstraints,
): Promise<CoreMediaStream> {
  const context = takePrimedAudioContext() ?? createAudioContext();
  let inputStream: MediaStream;
  try {
    inputStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    void context?.close().catch(() => {});
    throw error;
  }
  return await processMicrophoneStream(inputStream, context) as unknown as CoreMediaStream;
}

export function releaseProcessedMicrophone(stream: CoreMediaStream) {
  const nativeStream = stream as unknown as MediaStream;
  const release = processedStreams.get(nativeStream);
  processedStreams.delete(nativeStream);

  if (release) {
    release();
  } else {
    stopTracks(nativeStream);
  }
}

export async function startMicrophoneAudioTest(): Promise<() => void> {
  prepareMicrophoneAudioContext();
  const stream = await captureProcessedMicrophone({
    video: false,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  let monitor: HTMLAudioElement | null = null;

  try {
    monitor = new Audio();
    monitor.srcObject = stream as unknown as globalThis.MediaStream;
    monitor.volume = 0.8;
    monitor.setAttribute("playsinline", "");
    await monitor.play();
  } catch (error) {
    if (monitor) monitor.srcObject = null;
    releaseProcessedMicrophone(stream);
    throw error;
  }

  const activeMonitor = monitor;

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    activeMonitor.pause();
    activeMonitor.srcObject = null;
    releaseProcessedMicrophone(stream);
  };
}
