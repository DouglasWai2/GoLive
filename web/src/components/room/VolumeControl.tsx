import { VolumeIcon, VolumeMutedIcon } from "../icons";
import { useEffect, useRef, useState } from "react";

type VolumeControlProps = {
  volume: number;
  muted: boolean;
  disabled?: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
};

export function VolumeControl({ volume, muted, disabled = false, onVolumeChange, onToggleMute }: VolumeControlProps) {
  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(event.target.value));
  };
  const [active, setActive] = useState(false);
  const timer = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const handleMouseEnter = (): void => {
    clearCloseTimer();
    setActive(true);
  };

  const handleMouseLeave = (): void => {
    clearCloseTimer();
    timer.current = window.setTimeout(() => setActive(false), 400);
  };

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
      }}
      className={`volume-control ${muted ? "is-muted" : ""} ${disabled ? "is-disabled" : ""}`}
    >
      <button
        className="icon-button"
        onClick={() => setActive(true)}
        title={disabled ? "No shared audio" : "Stream volume"}
        aria-label={disabled ? "No shared audio" : "Open stream volume controls"}
        aria-expanded={active}
      >
        {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      {active && (
        <div className="volume-popover" role="group" aria-label="Stream volume controls">
          {disabled ? (
            <span className="volume-unavailable">No shared audio</span>
          ) : (
            <>
              <div className="volume-popover-head">
                <button type="button" className="volume-mute-button" onClick={onToggleMute}>
                  {muted ? <VolumeMutedIcon size={16} /> : <VolumeIcon size={16} />}
                  {muted ? "Unmute" : "Mute"}
                </button>
                <span>{muted ? 0 : Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Stream volume"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
