
import { StatsIcon } from "../icons";

interface StatsButtonProps {
  statsEnabled: boolean;
  toggleStats: () => void;
}

export default function StatsButton({ statsEnabled, toggleStats }: StatsButtonProps) {
  return <button
    className={`icon-button ${statsEnabled ? "active" : "muted"}`}
    onClick={toggleStats}
    title="Toggle stream stats"
  >
    <StatsIcon />
  </button>
}