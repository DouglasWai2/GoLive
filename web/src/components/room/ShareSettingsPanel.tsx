import { useState } from "react";
import type { ShareSettings } from "../../types";
import {
  bitrateOptions,
  DEFAULT_SHARE_SETTINGS,
  frameRateOptions,
  resolutionOptions,
} from "../../utils/sharePresets";
import { ScreenIcon } from "../icons";

type ShareSettingsPanelProps = {
  isStarting: boolean;
  onStart: (settings: ShareSettings) => void;
  onCancel: () => void;
};

export function ShareSettingsPanel({ isStarting, onStart, onCancel }: ShareSettingsPanelProps) {
  const [settings, setSettings] = useState<ShareSettings>(DEFAULT_SHARE_SETTINGS);

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