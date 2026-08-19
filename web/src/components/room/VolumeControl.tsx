import { VolumeIcon, VolumeMutedIcon } from "../icons";
import { useRef, useState } from "react";

type VolumeControlProps = {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
};

export function VolumeControl({ volume, muted, onVolumeChange, onToggleMute }: VolumeControlProps) {
  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(event.target.value));
  };
  const [active, setActive] = useState(false);
  let timer: NodeJS.Timeout | null = null;

  const handleMouseEnter = (): void => {
    if (timer) clearTimeout(timer);
    setActive(true);
  };

  const handleMouseLeave = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setActive(false), 400);
  };

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className={`volume-control ${muted ? "is-muted" : ""}`}>
      <button
        className="icon-button"
        onClick={onToggleMute}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      {active && <div className={`volume-popover`}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          aria-label="Volume"
        />
      </div>}
    </div>
  );
}