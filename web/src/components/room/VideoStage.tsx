import { useEffect, useRef, useState } from "react";
import { FullscreenExitIcon, ScreenIcon, UsersIcon } from "../icons";
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
import StatsButton from "./StatsButton";
import { VolumeControl } from "./VolumeControl";

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
};

const STATS_STORAGE_KEY = "golive.stats.enabled";
const VOLUME_STORAGE_KEY = "golive.volume";
const MUTED_STORAGE_KEY = "golive.muted";

function isNotAllowedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function VideoStage({ localStream, peers, remoteStreams, connectionStates, remoteStats, outboundStats, localQuality, localName, status }: VideoStageProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCinemaControls, setShowCinemaControls] = useState(false);
  const [cinemaAudioBlocked, setCinemaAudioBlocked] = useState(false);
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
  const cinemaRef = useRef<HTMLDivElement>(null);
  const cinemaVideoRef = useRef<HTMLVideoElement>(null);
  const cinemaControlsTimer = useRef<number | null>(null);
  const participantsRef = useRef<HTMLDivElement>(null);
  const participantsButtonRef = useRef<HTMLButtonElement>(null);

  const activeSharer = peers.find((peer) => peer.sharing);
  const remoteTiles = peers.filter((peer) => remoteStreams[peer.id]);

  const cinemaPeer = remoteTiles[0];
  const cinemaStream = cinemaPeer ? remoteStreams[cinemaPeer.id]! : null;
  const cinemaHasAudio = Boolean(cinemaStream?.getAudioTracks().length);
  const cinemaName = cinemaPeer?.name ?? "";
  const cinemaStats = cinemaPeer ? remoteStats[cinemaPeer.id] ?? null : null;
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

  const clearCinemaControlsTimer = () => {
    if (cinemaControlsTimer.current !== null) {
      window.clearTimeout(cinemaControlsTimer.current);
      cinemaControlsTimer.current = null;
    }
  };

  const revealCinemaControls = () => {
    setShowCinemaControls(true);
    clearCinemaControlsTimer();
    cinemaControlsTimer.current = window.setTimeout(() => {
      setShowCinemaControls(false);
    }, 2500);
  };

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement()));
    };

    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);

    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
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

  useEffect(() => {
    if (!isFullscreen) {
      clearCinemaControlsTimer();
      setShowCinemaControls(false);
      return;
    }

    revealCinemaControls();

    return () => clearCinemaControlsTimer();
  }, [isFullscreen]);

  useEffect(() => {
    const video = cinemaVideoRef.current;
    let active = true;

    if (!video) return;

    if (isFullscreen && cinemaStream) {
      video.volume = volume;
      video.muted = muted;
      video.srcObject = cinemaStream;

      void video.play().then(
        () => {
          if (active && video.srcObject === cinemaStream) {
            setCinemaAudioBlocked(false);
          }
        },
        async (error: unknown) => {
          if (!isNotAllowedError(error) || !active || video.srcObject !== cinemaStream) {
            return;
          }

          video.muted = true;
          if (active) setCinemaAudioBlocked(cinemaHasAudio && !muted);

          try {
            await video.play();
          } catch {
            // The gesture-driven audio action remains visible if autoplay still fails.
          }
        },
      );
    } else {
      video.srcObject = null;
      setCinemaAudioBlocked(false);
    }

    return () => {
      active = false;
      if (video.srcObject === cinemaStream) video.srcObject = null;
    };
  }, [cinemaHasAudio, cinemaStream, isFullscreen]);

  useEffect(() => {
    const video = cinemaVideoRef.current;
    const container = cinemaRef.current;
    if (!video || !container) return;

    const fit = () => {
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      if (!containerWidth || !containerHeight) return;

      const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
      video.style.width = `${Math.max(1, Math.floor(videoWidth * scale))}px`;
      video.style.height = `${Math.max(1, Math.floor(videoHeight * scale))}px`;
    };

    const fitNextFrame = () => window.requestAnimationFrame(fit);

    fit();
    video.addEventListener("resize", fit);
    video.addEventListener("loadedmetadata", fit);
    window.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", fitNextFrame);

    return () => {
      video.style.width = "";
      video.style.height = "";
      video.removeEventListener("resize", fit);
      video.removeEventListener("loadedmetadata", fit);
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", fitNextFrame);
    };
  }, [cinemaStream]);

  useEffect(() => {
    const video = cinemaVideoRef.current;
    if (!video) return;

    let active = true;
    const shouldMute = muted || cinemaAudioBlocked;
    video.volume = volume;
    video.muted = shouldMute;

    if (isFullscreen && cinemaHasAudio && !shouldMute) {
      void video.play().catch((error: unknown) => {
        if (active && video.srcObject === cinemaStream && isNotAllowedError(error)) {
          video.muted = true;
          setCinemaAudioBlocked(true);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [cinemaAudioBlocked, cinemaHasAudio, cinemaStream, isFullscreen, muted, volume]);

  const hearCinemaAudio = async () => {
    const video = cinemaVideoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = false;

    try {
      await video.play();
      setCinemaAudioBlocked(false);
    } catch {
      setCinemaAudioBlocked(true);
    }
  };

  const toggleFullscreen = async (sourceVideo: HTMLVideoElement) => {
    if (getFullscreenElement()) {
      await exitFullscreen();
      return;
    }

    if (!cinemaRef.current) return;

    if (!isElementFullscreenSupported()) {
      try {
        await requestVideoFullscreen(sourceVideo);
      } catch (caught) {
        console.warn("Could not enter fullscreen video mode", caught);
      }
      return;
    }

    if (cinemaVideoRef.current) {
      cinemaVideoRef.current.volume = volume;
      cinemaVideoRef.current.muted = muted || cinemaAudioBlocked;
      cinemaVideoRef.current.srcObject = cinemaStream;
    }

    try {
      await requestFullscreen(cinemaRef.current);
    } catch {
      if (cinemaVideoRef.current) cinemaVideoRef.current.srcObject = null;

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
        {remoteTiles
          .filter((peer) => !isFullscreen || peer.id !== cinemaPeer?.id)
          .map((peer) => (
          <VideoTile
            key={peer.id}
            stream={remoteStreams[peer.id]!}
            name={peer.name}
            state={connectionStates[peer.id]}
            stats={statsEnabled ? remoteStats[peer.id] ?? null : null}
            volume={volume}
            muted={muted}
            statsEnabled={statsEnabled}
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
            onToggleStats={toggleStats}
            onFullscreen={(video) => void toggleFullscreen(video)}
          />
          ))}
        {!localStream && remoteTiles.length === 0 && (
          <div className="empty-stage">
            <div className="screen-outline"><ScreenIcon size={38} /><span className="scan-line" /></div>
            <h2>{emptyTitle}</h2>
            <p>{emptyMessage}</p>
          </div>
        )}
      </div>

      <div
        className={`cinema ${isFullscreen && !showCinemaControls ? "controls-hidden" : ""}`}
        ref={cinemaRef}
        onMouseMove={revealCinemaControls}
      >
        <video ref={cinemaVideoRef} autoPlay playsInline />
        {cinemaHasAudio && cinemaAudioBlocked && !muted && (
          <button type="button" className="audio-playback-action" onClick={() => void hearCinemaAudio()}>
            Tap to hear shared audio
          </button>
        )}
        <div className="cinema-meta">
          <span className="live-dot" />
          <strong>{cinemaName ? `${cinemaName}'s screen` : "Screen"}</strong>
          <small>Press Esc to exit</small>
        </div>
        {statsEnabled && cinemaStats && <StreamStats stats={cinemaStats} />}
        <div className="cinema-controls">
          <StatsButton statsEnabled={statsEnabled} toggleStats={toggleStats} />
          {cinemaHasAudio && (
            <VolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={changeVolume}
              onToggleMute={toggleMute}
            />
          )}
          <button className="icon-button" onClick={() => void exitFullscreen()} title="Exit fullscreen">
            <FullscreenExitIcon /> Exit fullscreen
          </button>
        </div>
      </div>
    </section>
  );
}
