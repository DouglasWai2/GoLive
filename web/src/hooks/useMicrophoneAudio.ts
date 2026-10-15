import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMicrophoneAudioSettings,
  isMicrophoneAudioProcessingSupported,
  setMicrophoneAudioSettings,
  startMicrophoneAudioTest,
} from "../audio/microphoneAudio";
import type { MicrophoneAudioSettings } from "../audio/microphoneAudio";

export type MicrophoneTestState = "idle" | "starting" | "active" | "cancelling" | "error";

function microphoneTestErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was not granted.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found.";
  }
  return "The microphone test could not be started.";
}

export function useMicrophoneAudio() {
  const [settings, setSettings] = useState(getMicrophoneAudioSettings);
  const settingsRef = useRef(settings);
  const [testState, setTestState] = useState<MicrophoneTestState>("idle");
  const testStateRef = useRef<MicrophoneTestState>("idle");
  const [testError, setTestError] = useState("");
  const testStopRef = useRef<(() => void) | null>(null);
  const testGenerationRef = useRef(0);
  const testCapturePendingRef = useRef(false);

  const setCurrentTestState = useCallback((next: MicrophoneTestState) => {
    testStateRef.current = next;
    setTestState(next);
  }, []);

  const updateSettings = useCallback((update: Partial<MicrophoneAudioSettings>) => {
    const next = { ...settingsRef.current, ...update };
    settingsRef.current = next;
    setSettings(next);
    setMicrophoneAudioSettings(next);
  }, []);

  const stopTest = useCallback(() => {
    testGenerationRef.current += 1;
    testStopRef.current?.();
    testStopRef.current = null;
    setTestError("");
    setCurrentTestState(
      testCapturePendingRef.current
        && (testStateRef.current === "starting" || testStateRef.current === "cancelling")
        ? "cancelling"
        : "idle",
    );
  }, [setCurrentTestState]);

  const startTest = useCallback(async () => {
    if (
      testStateRef.current === "starting"
      || testStateRef.current === "active"
      || testStateRef.current === "cancelling"
    ) return;

    const generation = ++testGenerationRef.current;
    testCapturePendingRef.current = true;
    setTestError("");
    setCurrentTestState("starting");

    try {
      const stop = await startMicrophoneAudioTest();
      testCapturePendingRef.current = false;
      if (generation !== testGenerationRef.current) {
        stop();
        setCurrentTestState("idle");
        return;
      }

      testStopRef.current = stop;
      setCurrentTestState("active");
    } catch (error) {
      testCapturePendingRef.current = false;
      if (generation !== testGenerationRef.current) {
        setCurrentTestState("idle");
        return;
      }
      setTestError(microphoneTestErrorMessage(error));
      setCurrentTestState("error");
    }
  }, [setCurrentTestState]);

  useEffect(() => () => {
    testGenerationRef.current += 1;
    testStopRef.current?.();
    testStopRef.current = null;
  }, []);

  return {
    settings,
    updateSettings,
    testState,
    testError,
    startTest,
    stopTest,
    processingSupported: isMicrophoneAudioProcessingSupported(),
  };
}
