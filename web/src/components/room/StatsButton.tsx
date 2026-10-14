
import { StatsIcon } from "../icons";

interface StatsButtonProps {
  statsEnabled: boolean;
  toggleStats: () => void;
}

export default function StatsButton({ statsEnabled, toggleStats }: StatsButtonProps) {
  return <button
    className={`icon-button stats-button ${statsEnabled ? "active" : "muted"}`}
    onClick={toggleStats}
    type="button"
    title={statsEnabled ? "Hide stream stats" : "Show stream stats"}
    aria-label={statsEnabled ? "Hide stream stats" : "Show stream stats"}
    aria-pressed={statsEnabled}
  >
    <StatsIcon />
  </button>
}
