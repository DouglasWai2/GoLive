import { useEffect, useRef, useState } from "react";
import { ScreenIcon, UsersIcon } from "../icons";
import { VideoTile } from "../VideoTile";
import { StreamStats } from "./StreamStats";
import type {
  OutboundVideoStats,
  Peer,
  PeerConnectionState,
  RemoteVideoStats,
  SocketStatus,
} from "../../types";
import {
  exitFullscreen,
  getFullscreenElement,
  isElementFullscreenSupported,
  requestFullscreen,
  requestVideoFullscreen,
} from "../../utils/fullscreen";

type VideoStageProps = {
  localStream: MediaStream | null;
  peers: Peer[];
  remoteStreams: Record<string, MediaStream>;
  connectionStates: Record<string, PeerConnectionState>;
  remoteStats: Record<string, RemoteVideoStats | null>;
  outboundStats: Record<string, OutboundVideoStats>;
  localQuality: string | null;
  localName: string;
  status: SocketStatus;
  onLeaveDisconnected: () => void;
};

const STATS_STORAGE_KEY = "golive.stats.enabled";
const VOLUME_STORAGE_KEY = "golive.volume";
const MUTED_STORAGE_KEY = "golive.muted";

export function VideoStage({ localStream, peers, remoteStreams, connectionStates, remoteStats, outboundStats, localQuality, localName, status, onLeaveDisconnected }: VideoStageProps) {
  const [fullscreenPeerId, setFullscreenPeerId] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [statsEnabled, setStatsEnabled] = useState(() => {
    try {
      return localStorage.getItem(STATS_STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [volume, setVolume] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(VOLUME_STORAGE_KEY));
      return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 1;
    } catch {
      return 1;
    }
  });
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const participantsRef = useRef<HTMLDivElement>(null);
  const participantsButtonRef = useRef<HTMLButtonElement>(null);

  const activeSharer = peers.find((peer) => peer.sharing);
  const remoteTiles = peers.filter((peer) => remoteStreams[peer.id]);

  const localOutboundStats = peers.flatMap((peer) => {
    const stats = outboundStats[peer.id];
    return stats ? [{ peerId: peer.id, peerName: peer.name, stats }] : [];
  });
  const emptyTitle =
    status === "reconnecting"
      ? "Reconnecting to the room..."
      : status === "disconnected"
        ? "Connection lost"
        : activeSharer
          ? "Connecting to the screen..."
          : "No screen on air";
  const emptyMessage =
    status === "reconnecting"
      ? "Your session will resume automatically when the connection returns."
      : status === "disconnected"
        ? "Leave and rejoin the room to start a new session."
        : activeSharer
          ? "A secure peer-to-peer connection is being established."
          : "Share this room link, then choose a window or display to begin.";

  useEffect(() => {
    const onChange = () => {
      const element = getFullscreenElement();
      setFullscreenPeerId(
        element instanceof HTMLElement ? element.dataset.peerId ?? null : null,
      );
    };

    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("mozfullscreenchange", onChange);

    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("mozfullscreenchange", onChange);
    };
  }, []);

  useEffect(() => {
    if (!showParticipants) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !participantsRef.current?.contains(event.target)) {
        setShowParticipants(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setShowParticipants(false);
      participantsButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showParticipants]);

  const toggleFullscreen = async (sourceVideo: HTMLVideoElement, tile: HTMLElement) => {
    if (getFullscreenElement()) {
      await exitFullscreen();
      return;
    }

    if (!isElementFullscreenSupported()) {
      try {
        await requestVideoFullscreen(sourceVideo);
      } catch (caught) {
        console.warn("Could not enter fullscreen video mode", caught);
      }
      return;
    }

    try {
      await requestFullscreen(tile);
    } catch {
      try {
        await requestVideoFullscreen(sourceVideo);
      } catch (caught) {
        console.warn("Could not enter fullscreen video mode", caught);
      }
    }
  };

  const toggleStats = () => {
    setStatsEnabled((current) => {
      const next = !current;

      try {
        localStorage.setItem(STATS_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* Ignore storage failures. */
      }

      return next;
    });
  };

  const changeVolume = (next: number) => {
    setVolume(next);

    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
    } catch {
      /* Ignore storage failures. */
    }

    if (next > 0) {
      setMuted(false);

      try {
        localStorage.setItem(MUTED_STORAGE_KEY, "0");
      } catch {
        /* Ignore storage failures. */
      }
    }
  };

  const toggleMute = () => {
    setMuted((current) => {
      const next = !current;

      try {
        localStorage.setItem(MUTED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* Ignore storage failures. */
      }

      return next;
    });
  };

  return (
    <section className="stage">
      <div className="stage-heading">
        <div>
          <p className="eyebrow"><span /> Live room</p>
          <h1>{localStream ? "You are presenting" : activeSharer ? `${activeSharer.name} is presenting` : "Ready when you are"}</h1>
        </div>
        <div className="stage-actions">
          <div className="participants" ref={participantsRef}>
            <button
              ref={participantsButtonRef}
              type="button"
              className="people-count"
              aria-expanded={showParticipants}
              aria-controls="participants-list"
              onClick={() => setShowParticipants((current) => !current)}
            >
              <UsersIcon />
              <strong>{peers.length + 1}</strong>
              <span className="people-count-label">in room</span>
            </button>
            {showParticipants && (
              <div id="participants-list" className="participants-popover" role="region" aria-label="Participants in room">
                <div className="participants-heading">
                  <strong>Participants</strong>
                  <span>{peers.length + 1}</span>
                </div>
                <ul>
                  <li>
                    <span className="participant-avatar">{localName.slice(0, 1).toUpperCase()}</span>
                    <span className="participant-name"><strong>{localName}</strong><small>You</small></span>
                  </li>
                  {peers.map((peer) => (
                    <li key={peer.id}>
                      <span className="participant-avatar">{peer.name.slice(0, 1).toUpperCase()}</span>
                      <span className="participant-name"><strong>{peer.name}</strong></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`video-grid ${localStream || remoteTiles.length ? "has-video" : ""}`}>
        {localStream && (
          <VideoTile
            stream={localStream}
            name={localName}
            local
            qualityLabel={localQuality}
            outboundStats={localOutboundStats}
            statsEnabled={statsEnabled}
            onToggleStats={toggleStats}
          />
        )}
        {remoteTiles.map((peer) => (
          <VideoTile
            key={peer.id}
            stream={remoteStreams[peer.id]!}
            name={peer.name}
            state={connectionStates[peer.id]}
            stats={statsEnabled ? remoteStats[peer.id] ?? null : null}
            volume={volume}
            muted={muted}
            statsEnabled={statsEnabled}
            fullscreenId={peer.id}
            isFullscreen={fullscreenPeerId === peer.id}
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
            onToggleStats={toggleStats}
            onFullscreen={(video, tile) => void toggleFullscreen(video, tile)}
          />
        ))}
        {!localStream && remoteTiles.length === 0 && (
          <div className="empty-stage">
            <div className="screen-outline"><ScreenIcon size={38} /><span className="scan-line" /></div>
            <h2>{emptyTitle}</h2>
            <p>{emptyMessage}</p>
            {status === "disconnected" && <button className="leave-button empty-leave-button" type="button" onClick={onLeaveDisconnected}>Leave room</button>}
          </div>
        )}
      </div>
    </section>
  );
}
