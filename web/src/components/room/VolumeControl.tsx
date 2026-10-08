import { VolumeIcon, VolumeMutedIcon } from "../icons";

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
  const level = muted || disabled ? 0 : volume;

  return (
    <div className={`volume-control ${muted ? "is-muted" : ""} ${disabled ? "is-disabled" : ""}`}>
      <button
        type="button"
        className="icon-button"
        onClick={onToggleMute}
        disabled={disabled}
        title={disabled ? "No shared audio" : muted ? "Unmute" : "Mute"}
        aria-label={disabled ? "No shared audio" : muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
      >
        {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={level}
        disabled={disabled}
        onChange={handleVolumeChange}
        aria-label={disabled ? "No shared audio" : "Stream volume"}
        style={{ backgroundImage: `linear-gradient(to right, var(--acid) ${level * 100}%, #45453f ${level * 100}%)` }}
      />
    </div>
  );
}
