import { useState } from "react";
import type { ShareSettings } from "../../types";
import {
  bitrateOptions,
  DEFAULT_SHARE_SETTINGS,
  frameRateOptions,
  resolutionOptions,
  videoCodecOptions,
} from "@golive/core";
import { ScreenIcon } from "../icons";
import { getBrowserScreenVideoCodecs } from "../../platform/webAdapter";

type ShareSettingsPanelProps = {
  isStarting: boolean;
  onStart: (settings: ShareSettings) => void;
  onCancel: () => void;
};

export function ShareSettingsPanel({ isStarting, onStart, onCancel }: ShareSettingsPanelProps) {
  const [settings, setSettings] = useState<ShareSettings>(DEFAULT_SHARE_SETTINGS);
  const [availableCodecs] = useState(getBrowserScreenVideoCodecs);

  const resolution = resolutionOptions.find(
    (option) => option.width === settings.width && option.height === settings.height,
  );
  const frameRate = frameRateOptions.find((option) => option.value === settings.frameRate);
  const bitrate = bitrateOptions.find((option) => option.value === settings.maxBitrate);

  return (
    <div className="share-settings" role="dialog" aria-label="Share quality settings">
      <div className="share-settings-head">
        <strong>Share your screen</strong>
        <small>Quality caps for every viewer</small>
      </div>

      <div className="setting-row">
        <label>Resolution</label>
        <div className="segmented">
          {resolutionOptions.map((option) => (
            <button
              key={option.label}
              className={resolution?.label === option.label ? "active" : ""}
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  width: option.width,
                  height: option.height,
                }))
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row audio-setting">
        <div>
          <label>Share audio</label>
          <small>Your browser controls which sources can include audio. System audio may include calls or private sounds.</small>
        </div>
        <button
          type="button"
          className={`audio-toggle ${settings.includeAudio ? "active" : ""}`}
          aria-pressed={settings.includeAudio}
          onClick={() => setSettings((current) => ({
            ...current,
            includeAudio: !current.includeAudio,
          }))}
        >
          {settings.includeAudio ? "On" : "Off"}
        </button>
      </div>

      <div className="setting-row">
        <label>Frame rate</label>
        <div className="segmented">
          {frameRateOptions.map((option) => (
            <button
              key={option.label}
              className={frameRate?.value === option.value ? "active" : ""}
              onClick={() =>
                setSettings((current) => ({ ...current, frameRate: option.value }))
              }
            >
              {option.label} fps
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <label>Max bitrate</label>
        <div className="segmented">
          {bitrateOptions.map((option) => (
            <button
              key={option.label}
              className={bitrate?.value === option.value ? "active" : ""}
              onClick={() =>
                setSettings((current) => ({ ...current, maxBitrate: option.value }))
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label" id="share-codec-label">Preferred video codec</span>
        <div className="segmented codec-segmented" role="group" aria-labelledby="share-codec-label">
          {videoCodecOptions.filter((option) => option.value === "auto" || availableCodecs.includes(option.value)).map((option) => (
            <button
              key={option.value}
              type="button"
              className={settings.videoCodec === option.value ? "active" : ""}
              aria-pressed={settings.videoCodec === option.value}
              onClick={() => setSettings((current) => ({ ...current, videoCodec: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
        <small className="setting-hint">The viewer must also support it; availability does not guarantee hardware encoding.</small>
      </div>

      <div className="share-settings-actions">
        <button className="ghost-button" onClick={onCancel} disabled={isStarting}>
          Cancel
        </button>
        <button
          className="primary-button"
          onClick={() => onStart(settings)}
          disabled={isStarting}
        >
          <ScreenIcon /> {isStarting ? "Choosing a screen..." : "Start sharing"}
        </button>
      </div>
    </div>
  );
}
