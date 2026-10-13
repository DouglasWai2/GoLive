import type { CallStageSource, Peer } from "../../types";

type ShareRailProps = {
  localStream: MediaStream | null;
  localName: string;
  peers: Peer[];
  focusedPeerId: string | null;
  stageSource: CallStageSource;
  onFocusPeer: (peerId: string) => void;
  onStageSourceChange: (source: CallStageSource) => void;
};

export function ShareRail({
  localStream,
  localName,
  peers,
  focusedPeerId,
  stageSource,
  onFocusPeer,
  onStageSourceChange,
}: ShareRailProps) {
  const activeSharers = peers.filter((peer) => peer.sharing && Boolean(peer.streamId));
  const shareCount = activeSharers.length + Number(Boolean(localStream));

  if (shareCount === 0) return null;

  return (
    <section className="share-rail" aria-label="Screen shares">
      <div className="share-rail-heading">
        <strong>Screen shares</strong>
        <span>{shareCount} live</span>
      </div>
      <div className="share-card-list" role="group" aria-label="Choose a screen to watch">
        {localStream && (
          <button
            type="button"
            className={`share-card ${stageSource === "local" ? "selected" : ""}`}
            aria-pressed={stageSource === "local"}
            onClick={() => onStageSourceChange("local")}
          >
            <span className="share-card-avatar" aria-hidden="true">{localName.slice(0, 1).toUpperCase()}</span>
            <span className="share-card-copy">
              <strong>Your screen</strong>
              <small>{stageSource === "local" ? "On stage" : "Bring to stage"}</small>
            </span>
            <span className="live-dot" aria-hidden="true" />
          </button>
        )}
        {activeSharers.map((peer) => {
          const isFocused = peer.id === focusedPeerId;
          const isOnStage = isFocused && stageSource === "remote";
          const label = isOnStage
            ? "On stage"
            : isFocused
              ? "In preview"
              : "Watch screen";

          return (
            <button
              key={peer.id}
              type="button"
              className={`share-card ${isFocused ? "selected" : ""}`}
              aria-pressed={isFocused}
              onClick={() => {
                if (isFocused) {
                  onStageSourceChange("remote");
                } else {
                  onFocusPeer(peer.id);
                }
              }}
            >
              <span className="share-card-avatar" aria-hidden="true">{peer.name.slice(0, 1).toUpperCase()}</span>
              <span className="share-card-copy">
                <strong>{peer.name}</strong>
                <small>{label}</small>
              </span>
              <span className="live-dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <p className="share-rail-hint">
        Other screens appear here as cards. Only the screen you watch receives video.
      </p>
    </section>
  );
}
