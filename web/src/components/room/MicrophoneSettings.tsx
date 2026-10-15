import { useEffect, useState } from "react";
import {
  getMicrophoneMeterPosition,
  getMicrophoneSensitivityFromThresholdDb,
  getNoiseGateThresholdDb,
  subscribeMicrophoneAudioMeter,
} from "../../audio/microphoneAudio";
import type { MicrophoneAudioSettings } from "../../audio/microphoneAudio";
import type { MicrophoneAudioMeterState } from "../../audio/microphoneAudio";
import type { MicrophoneTestState } from "../../hooks/useMicrophoneAudio";

const INPUT_THRESHOLD_MIN_DB = getNoiseGateThresholdDb(100);
const INPUT_THRESHOLD_MAX_DB = getNoiseGateThresholdDb(0);
const INPUT_THRESHOLD_MIN_POSITION = getMicrophoneMeterPosition(INPUT_THRESHOLD_MIN_DB);
const INPUT_THRESHOLD_MAX_POSITION = getMicrophoneMeterPosition(INPUT_THRESHOLD_MAX_DB);
const SENSITIVITY_SLIDER_THUMB_HALF_SIZE_PX = 7;

type MicrophoneSettingsProps = {
  id: string;
  settings: MicrophoneAudioSettings;
  onChange: (settings: Partial<MicrophoneAudioSettings>) => void;
  micMuted: boolean;
  testState: MicrophoneTestState;
  testError: string;
  processingSupported: boolean;
  onStartTest: () => void;
  onStopTest: () => void;
};

export function MicrophoneSettings({
  id,
  settings,
  onChange,
  micMuted,
  testState,
  testError,
  processingSupported,
  onStartTest,
  onStopTest,
}: MicrophoneSettingsProps) {
  const testIsRunning = testState === "starting" || testState === "active" || testState === "cancelling";
  const [meterState, setMeterState] = useState<MicrophoneAudioMeterState>({ status: "idle", reading: null });
  const meterReading = meterState.reading;
  const thresholdDb = meterReading?.thresholdDb ?? getNoiseGateThresholdDb(settings.sensitivity);
  const thresholdPosition = getMicrophoneMeterPosition(thresholdDb);
  const levelPosition = meterReading ? getMicrophoneMeterPosition(meterReading.levelDb) : 0;
  const measuredLevel = meterReading
    ? `${Math.round(meterReading.levelDb)} dBFS`
    : meterState.status === "unavailable"
      ? "Meter unavailable"
      : meterState.status === "listening"
        ? "Listening…"
        : !processingSupported
          ? "Meter unavailable"
          : !micMuted || testState === "starting" || testState === "active"
            ? "Waiting for input"
            : "Start test to view level";
  const thresholdLabel = settings.gateStrength === 0
    ? "Gate off"
    : settings.automaticSensitivity && !meterReading
      ? meterState.status === "unavailable"
        ? "Auto threshold · unavailable"
        : meterState.status === "listening"
          ? "Auto threshold · measuring"
          : "Auto threshold · waiting for microphone"
      : meterReading
        ? `${settings.automaticSensitivity ? "Auto · " : ""}Gate ${meterReading.gateOpen ? "open" : "closed"} · ${Math.round(thresholdDb)} dBFS`
        : `Gate threshold · ${Math.round(thresholdDb)} dBFS`;

  useEffect(() => subscribeMicrophoneAudioMeter(setMeterState), []);

  return (
    <section id={id} className="microphone-settings" aria-label="Microphone settings">
      <header className="microphone-settings-head">
        <strong>Microphone settings</strong>
        <small>Changes apply live and are saved on this device.</small>
      </header>

      <div className="microphone-setting">
        <div className="microphone-setting-heading">
          <label htmlFor="microphone-gate-strength">Noise gate</label>
          <output htmlFor="microphone-gate-strength">
            {settings.gateStrength === 0 ? "Off" : `${settings.gateStrength}%`}
          </output>
        </div>
        <small id="microphone-gate-help">Controls how much sound is reduced while the gate is closed.</small>
        <input
          id="microphone-gate-strength"
          type="range"
          min="0"
          max="100"
          step="1"
          value={settings.gateStrength}
          aria-describedby="microphone-gate-help"
          aria-valuetext={settings.gateStrength === 0 ? "Off" : `${settings.gateStrength} percent`}
          disabled={!processingSupported}
          onChange={(event) => onChange({ gateStrength: Number(event.currentTarget.value) })}
        />
      </div>

      <div className="microphone-setting">
        <div className="microphone-auto-sensitivity">
          <div className="microphone-auto-sensitivity-copy">
            <label htmlFor="microphone-auto-sensitivity">Adjust input sensitivity automatically</label>
            <small>Automatically follows background noise.</small>
          </div>
          <div className="microphone-auto-toggle">
            <input
              id="microphone-auto-sensitivity"
              type="checkbox"
              role="switch"
              checked={settings.automaticSensitivity}
              disabled={!processingSupported}
              onChange={(event) => onChange({ automaticSensitivity: event.currentTarget.checked })}
            />
            <span className="microphone-auto-toggle-track" aria-hidden="true"><span /></span>
          </div>
        </div>
        <div className="microphone-setting-heading">
          <label htmlFor="microphone-sensitivity">Input sensitivity</label>
          <output htmlFor="microphone-sensitivity">
            {settings.automaticSensitivity ? "Auto" : `${Math.round(thresholdDb)} dBFS`}
          </output>
        </div>
        <small id="microphone-sensitivity-help">
          {settings.automaticSensitivity
            ? "Automatic mode adjusts the orange threshold to recent background noise."
            : "Set the orange opening threshold. A lower dBFS value lets quieter speech through."}
        </small>
        <div className="microphone-sensitivity-slider">
          <div
            className={`microphone-level-meter ${meterReading?.gateOpen ? "is-gate-open" : "is-gate-closed"}`}
            role="meter"
            aria-label="Captured microphone audio level"
            aria-valuemin={-70}
            aria-valuemax={-20}
            aria-valuenow={meterReading ? Math.max(-70, Math.min(-20, meterReading.levelDb)) : -70}
            aria-valuetext={meterReading ? `${measuredLevel}; ${thresholdLabel}` : measuredLevel}
          >
            <span className="microphone-level-meter-fill" aria-hidden="true" style={{ width: `${levelPosition}%` }} />
            {settings.gateStrength > 0 && (!settings.automaticSensitivity || meterReading) && (
              <span
                className="microphone-level-threshold"
                aria-hidden="true"
                style={{ left: `${thresholdPosition}%` }}
              />
            )}
          </div>
          <input
            id="microphone-sensitivity"
            type="range"
            min={INPUT_THRESHOLD_MIN_DB}
            max={INPUT_THRESHOLD_MAX_DB}
            step="0.27"
            value={thresholdDb}
            style={{
              left: `calc(${INPUT_THRESHOLD_MIN_POSITION}% - ${SENSITIVITY_SLIDER_THUMB_HALF_SIZE_PX}px)`,
              width: `calc(${INPUT_THRESHOLD_MAX_POSITION - INPUT_THRESHOLD_MIN_POSITION}% + ${SENSITIVITY_SLIDER_THUMB_HALF_SIZE_PX * 2}px)`,
            }}
            aria-describedby="microphone-sensitivity-help microphone-input-level"
            aria-valuetext={settings.automaticSensitivity ? "Automatic threshold" : `${Math.round(thresholdDb)} dBFS threshold`}
            disabled={!processingSupported || settings.automaticSensitivity}
            onChange={(event) => onChange({
              sensitivity: getMicrophoneSensitivityFromThresholdDb(Number(event.currentTarget.value)),
            })}
          />
        </div>
        <div id="microphone-input-level" className="microphone-level-readout">
          <span>Mic {measuredLevel}</span>
          <span>{thresholdLabel}</span>
        </div>
      </div>

      {!processingSupported && (
        <p className="microphone-settings-note" role="status">
          This browser does not support microphone audio processing.
        </p>
      )}
      {processingSupported && meterState.status === "unavailable" && (
        <p className="microphone-settings-note" role="status">
          Browser audio processing could not start. The microphone may still work, but the live meter and noise gate are unavailable.
        </p>
      )}

      <div className="microphone-test-row">
        <button
          type="button"
          className={testIsRunning ? "microphone-test-button is-testing" : "microphone-test-button"}
          disabled={!micMuted || testState === "cancelling"}
          aria-pressed={testState === "active"}
          aria-describedby="microphone-test-note"
          onClick={testIsRunning ? onStopTest : onStartTest}
        >
          {testState === "starting"
            ? "Cancel test"
            : testState === "active"
              ? "Stop test"
              : testState === "cancelling"
                ? "Cancelling test…"
                : "Test microphone"}
        </button>
        <small id="microphone-test-note">
          {!micMuted
            ? "Mute your microphone to test privately."
            : "Use headphones to avoid feedback while monitoring."}
        </small>
      </div>

      {testError && <p className="microphone-test-error" role="alert">{testError}</p>}
      {testState === "active" && <p className="microphone-test-status" role="status">Live test is private and is not sent to the call.</p>}
      {testState === "cancelling" && <p className="microphone-test-status" role="status">Waiting for the browser microphone request to finish; any late capture will be stopped.</p>}
    </section>
  );
}
