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
import { HeadphonesIcon, MicrophoneIcon } from "../icons";

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
      ? "Unavailable"
      : meterState.status === "listening"
        ? "Listening…"
        : !processingSupported
          ? "Unavailable"
          : !micMuted || testState === "starting" || testState === "active"
            ? "Waiting"
            : "Test mic to see level";
  const thresholdLabel = settings.gateStrength === 0
    ? "Off"
    : meterReading
      ? `Gate ${meterReading.gateOpen ? "open" : "closed"}`
      : settings.automaticSensitivity && meterState.status === "unavailable"
        ? "Unavailable"
        : settings.automaticSensitivity && meterState.status === "listening"
          ? "Measuring"
          : settings.automaticSensitivity
            ? "Auto"
            : "";
  const thresholdOutput = settings.automaticSensitivity
    ? meterReading
      ? `Auto · ${Math.round(thresholdDb)} dBFS`
      : "Auto"
    : `${Math.round(thresholdDb)} dBFS`;

  useEffect(() => subscribeMicrophoneAudioMeter(setMeterState), []);

  return (
    <section id={id} className="microphone-settings" aria-label="Microphone settings">
      <header className="microphone-settings-head">
        <strong>Microphone settings</strong>
      </header>

      <div className="microphone-setting">
        <div className="microphone-setting-heading">
          <label htmlFor="microphone-gate-strength">Noise gate</label>
          <output htmlFor="microphone-gate-strength">
            {settings.gateStrength === 0 ? "Off" : `${settings.gateStrength}%`}
          </output>
        </div>
        <input
          id="microphone-gate-strength"
          type="range"
          min="0"
          max="100"
          step="1"
          value={settings.gateStrength}
          aria-valuetext={settings.gateStrength === 0 ? "Off" : `${settings.gateStrength} percent`}
          disabled={!processingSupported}
          onChange={(event) => onChange({ gateStrength: Number(event.currentTarget.value) })}
        />
      </div>

      <div className="microphone-setting">
        <div className="microphone-auto-sensitivity">
          <div className="microphone-auto-sensitivity-copy">
            <label htmlFor="microphone-auto-sensitivity">Auto</label>
          </div>
          <div className="microphone-auto-toggle">
            <input
              id="microphone-auto-sensitivity"
              type="checkbox"
              role="switch"
              aria-label="Adjust input sensitivity automatically"
              checked={settings.automaticSensitivity}
              disabled={!processingSupported}
              onChange={(event) => onChange({ automaticSensitivity: event.currentTarget.checked })}
            />
            <span className="microphone-auto-toggle-track" aria-hidden="true"><span /></span>
          </div>
        </div>
        <div className="microphone-setting-heading">
          <label htmlFor="microphone-sensitivity">Input sensitivity</label>
          <output htmlFor="microphone-sensitivity">{thresholdOutput}</output>
        </div>
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
            aria-describedby="microphone-input-level"
            aria-valuetext={settings.automaticSensitivity ? "Automatic threshold" : `${Math.round(thresholdDb)} dBFS threshold`}
            disabled={!processingSupported || settings.automaticSensitivity}
            onChange={(event) => onChange({
              sensitivity: getMicrophoneSensitivityFromThresholdDb(Number(event.currentTarget.value)),
            })}
          />
        </div>
        <div id="microphone-input-level" className="microphone-level-readout">
          <span><MicrophoneIcon size={13} />{measuredLevel}</span>
          {thresholdLabel && <span className="microphone-level-state">{thresholdLabel}</span>}
        </div>
      </div>

      {!processingSupported && (
        <p className="microphone-settings-note" role="status">
          Audio effects unavailable in this browser.
        </p>
      )}
      {processingSupported && meterState.status === "unavailable" && (
        <p className="microphone-settings-note" role="status">
          Audio processing unavailable. The mic still works; meter and gate are off.
        </p>
      )}

      <div className="microphone-test-row">
        <button
          type="button"
          className={testIsRunning ? "microphone-test-button is-testing" : "microphone-test-button"}
          disabled={!micMuted || testState === "cancelling"}
          aria-pressed={testState === "active"}
          aria-label={testState === "starting"
            ? "Cancel microphone test"
            : testState === "active"
              ? "Stop microphone test"
              : testState === "cancelling"
                ? "Stopping microphone test"
                : "Test microphone"}
          aria-describedby="microphone-test-note"
          onClick={testIsRunning ? onStopTest : onStartTest}
        >
          {testState === "starting"
            ? "Cancel"
            : testState === "active"
              ? "Stop"
              : testState === "cancelling"
                ? "Stopping…"
                : "Test mic"}
        </button>
        <small id="microphone-test-note">
          {!micMuted
            ? "Mute mic first."
            : <><HeadphonesIcon size={14} />Headphones recommended.</>}
        </small>
      </div>

      {testError && <p className="microphone-test-error" role="alert">{testError}</p>}
      {testState === "active" && <p className="microphone-test-status" role="status">Private test · not shared</p>}
      {testState === "cancelling" && <p className="microphone-test-status" role="status">Stopping when the browser responds…</p>}
    </section>
  );
}
