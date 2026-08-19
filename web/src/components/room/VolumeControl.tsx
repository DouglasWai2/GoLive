import { VolumeIcon, VolumeMutedIcon } from "../icons";

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

  return (
    <div className={`volume-control ${muted ? "is-muted" : ""}`}>
      <button
        className="icon-button"
        onClick={onToggleMute}
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      <div className="volume-popover">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}