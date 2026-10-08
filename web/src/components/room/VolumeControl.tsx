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
  const level = muted ? 0 : volume;

  return (
    <div className={`volume-control ${muted ? "is-muted" : ""}`}>
      <button
        type="button"
        className="icon-button"
        onClick={onToggleMute}
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
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
        onChange={handleVolumeChange}
        aria-label="Volume"
        style={{ backgroundImage: `linear-gradient(to right, var(--acid) ${level * 100}%, #45453f ${level * 100}%)` }}
      />
    </div>
  );
}
