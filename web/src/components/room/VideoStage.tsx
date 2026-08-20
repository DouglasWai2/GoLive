import { useEffect, useRef, useState } from "react";
import { FullscreenExitIcon, ScreenIcon, UsersIcon } from "../icons";
import { VideoTile } from "../VideoTile";
import { StreamStats } from "./StreamStats";
import type { Peer, RemoteVideoStats } from "../../types";
import { exitFullscreen, getFullscreenElement, requestFullscreen } from "../../utils/fullscreen";
import StatsButton from "./StatsButton";
import { VolumeControl } from "./VolumeControl";

type VideoStageProps = {
  localStream: MediaStream | null;
  peers: Peer[];
  remoteStreams: Record<string, MediaStream>;
  connectionStates: Record<string, RTCPeerConnectionState>;
  remoteStats: Record<string, RemoteVideoStats | null>;
  localQuality: string | null;
  localName: string;
};

const STATS_STORAGE_KEY = "golive.stats.enabled";
const VOLUME_STORAGE_KEY = "golive.volume";
const MUTED_STORAGE_KEY = "golive.muted";

export function VideoStage({ localStream, peers, remoteStreams, connectionStates, remoteStats, localQuality, localName }: VideoStageProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCinemaControls, setShowCinemaControls] = useState(false);
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
  const videoFullscreenRef = useRef(false);

  const activeSharer = peers.find((peer) => peer.sharing);
  const remoteTiles = peers.filter((peer) => remoteStreams[peer.id]);

  const cinemaPeer = remoteTiles[0];
  const cinemaStream = cinemaPeer ? remoteStreams[cinemaPeer.id]! : null;
  const cinemaName = cinemaPeer?.name ?? "";
  const cinemaStats = cinemaPeer ? remoteStats[cinemaPeer.id] ?? null : null;

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
    const video = cinemaVideoRef.current;
    if (!video) return;

    const onBegin = () => {
      videoFullscreenRef.current = true;
      setIsFullscreen(true);
    };
    const onEnd = () => {
      videoFullscreenRef.current = false;
      setIsFullscreen(false);
    };

    video.addEventListener("webkitbeginfullscreen", onBegin);
    video.addEventListener("webkitendfullscreen", onEnd);

    return () => {
      video.removeEventListener("webkitbeginfullscreen", onBegin);
      video.removeEventListener("webkitendfullscreen", onEnd);
    };
  }, []);

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
    if (cinemaVideoRef.current) cinemaVideoRef.current.srcObject = cinemaStream;
    return () => {
      if (cinemaVideoRef.current) cinemaVideoRef.current.srcObject = null;
    };
  }, [cinemaStream]);

  useEffect(() => {
    if (cinemaVideoRef.current) {
      cinemaVideoRef.current.volume = volume;
      cinemaVideoRef.current.muted = muted;
    }
  }, [volume, muted]);

  const toggleFullscreen = async () => {
    if (getFullscreenElement()) {
      await exitFullscreen(videoFullscreenRef.current ? cinemaVideoRef.current ?? undefined : undefined);
      return;
    }

    if (!cinemaRef.current) return;

    try {
      videoFullscreenRef.current = false;
      await requestFullscreen(cinemaRef.current);
    } catch {
      const video = cinemaVideoRef.current;

      if (!video) {
        console.warn("Could not enter fullscreen video mode");
        return;
      }

      try {
        videoFullscreenRef.current = true;
        await requestFullscreen(video);
      } catch (caught) {
        videoFullscreenRef.current = false;
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
          <div className="people-count"><UsersIcon /><strong>{peers.length + 1}</strong> in room</div>
        </div>
      </div>

      <div className={`video-grid ${localStream || remoteTiles.length ? "has-video" : ""}`}>
        {localStream && <VideoTile stream={localStream} name={localName} local qualityLabel={localQuality} />}
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
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
            onToggleStats={toggleStats}
            onFullscreen={() => void toggleFullscreen()}
          />
        ))}
        {!localStream && remoteTiles.length === 0 && (
          <div className="empty-stage">
            <div className="screen-outline"><ScreenIcon size={38} /><span className="scan-line" /></div>
            <h2>{activeSharer ? "Connecting to the screen..." : "No screen on air"}</h2>
            <p>{activeSharer ? "A secure peer-to-peer connection is being established." : "Share this room link, then choose a window or display to begin."}</p>
          </div>
        )}
      </div>

      <div
        className={`cinema ${isFullscreen && !showCinemaControls ? "controls-hidden" : ""}`}
        ref={cinemaRef}
        onMouseMove={revealCinemaControls}
      >
        <video ref={cinemaVideoRef} autoPlay playsInline />
        <div className="cinema-meta">
          <span className="live-dot" />
          <strong>{cinemaName ? `${cinemaName}'s screen` : "Screen"}</strong>
          <small>Press Esc to exit</small>
        </div>
        {statsEnabled && cinemaStats && <StreamStats stats={cinemaStats} />}
        <div className="cinema-controls">
          <StatsButton statsEnabled={statsEnabled} toggleStats={toggleStats} />
          <VolumeControl
            volume={volume}
            muted={muted}
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
          />
          <button className="icon-button" onClick={() => void exitFullscreen(videoFullscreenRef.current ? cinemaVideoRef.current ?? undefined : undefined)} title="Exit fullscreen">
            <FullscreenExitIcon /> Exit fullscreen
          </button>
        </div>
      </div>
    </section>
  );
}