import { VolumeIcon, VolumeMutedIcon } from "../icons";

type VolumeControlProps = {
  volume: number;
  muted: boolean;
  disabled?: boolean;
  className?: string;
  volumeLabel?: string;
  muteLabel?: string;
  unmuteLabel?: string;
  disabledLabel?: string;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
};

export function VolumeControl({ volume, muted, disabled = false, className = "", volumeLabel = "Stream volume", muteLabel = "Mute", unmuteLabel = "Unmute", disabledLabel = "No shared audio", onVolumeChange, onToggleMute }: VolumeControlProps) {
  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(event.target.value));
  };
  const level = muted || disabled ? 0 : volume;
  const actionLabel = disabled ? disabledLabel : muted ? unmuteLabel : muteLabel;

  return (
    <div className={`volume-control ${className} ${muted ? "is-muted" : ""} ${disabled ? "is-disabled" : ""}`}>
      <button
        type="button"
        className="icon-button"
        onClick={onToggleMute}
        disabled={disabled}
        title={actionLabel}
        aria-label={actionLabel}
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
        aria-label={disabled ? disabledLabel : volumeLabel}
        style={{ backgroundImage: `linear-gradient(to right, var(--acid) ${level * 100}%, #45453f ${level * 100}%)` }}
      />
    </div>
  );
}
