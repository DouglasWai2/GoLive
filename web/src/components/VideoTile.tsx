import { useEffect, useRef, useState } from "react";
import type { PeerConnectionState, RemoteVideoStats } from "@golive/core";
import { FullscreenExitIcon, FullscreenIcon } from "./icons";
import { StreamStats, type OutboundStatsEntry } from "./room/StreamStats";
import StatsButton from "./room/StatsButton";
import { VolumeControl } from "./room/VolumeControl";
import { useVideoPlaybackState } from "../hooks/useVideoPlaybackState";
import { VideoLoadingOverlay } from "./VideoLoadingOverlay";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  local?: boolean;
  state?: PeerConnectionState;
  qualityLabel?: string | null;
  stats?: RemoteVideoStats | null;
  outboundStats?: OutboundStatsEntry[];
  volume?: number;
  muted?: boolean;
  statsEnabled?: boolean;
  fullscreenId?: string;
  isFullscreen?: boolean;
  onVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleStats?: () => void;
  onFullscreen?: (video: HTMLVideoElement, tile: HTMLElement) => void;
};

const CONTROLS_HIDE_DELAY = 2500;

function isNotAllowedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

async function startPlayback(
  video: HTMLVideoElement,
  muted: boolean,
  hasAudio: boolean,
  isCurrent: () => boolean,
  setAudioBlocked: (blocked: boolean) => void,
  setPlaybackBlocked: (blocked: boolean) => void,
) {
  video.muted = muted;

  try {
    await video.play();
    if (!isCurrent()) return;
    setAudioBlocked(false);
    setPlaybackBlocked(false);
  } catch (error) {
    if (!isCurrent()) return;
    if (!isNotAllowedError(error)) return;

    video.muted = true;
    setAudioBlocked(hasAudio && !muted);

    try {
      await video.play();
      if (isCurrent()) setPlaybackBlocked(false);
    } catch {
      if (isCurrent()) setPlaybackBlocked(true);
    }
  }
}

export function VideoTile({ stream, name, local = false, state, qualityLabel, stats, outboundStats = [], volume = 1, muted = false, statsEnabled = true, fullscreenId, isFullscreen = false, onVolumeChange, onToggleMute, onToggleStats, onFullscreen }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLElement>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hasAudio = stream.getAudioTracks().length > 0;
  const playbackPhase = useVideoPlaybackState(videoRef, stream, !local);

  const clearControlsTimer = () => {
    if (controlsTimer.current !== null) {
      clearTimeout(controlsTimer.current);
      controlsTimer.current = null;
    }
  };

  const scheduleControlsHide = () => {
    clearControlsTimer();
    controlsTimer.current = setTimeout(() => {
      controlsTimer.current = null;
      if (!tileRef.current?.querySelector(":focus-visible")) setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  };

  const revealControls = () => {
    clearControlsTimer();
    setControlsVisible(true);
  };

  useEffect(() => {
    setControlsVisible(true);
    if (isFullscreen || !tileRef.current?.matches(":hover")) scheduleControlsHide();
    return clearControlsTimer;
  }, [isFullscreen]);

  useEffect(() => {
    const video = videoRef.current;
    let active = true;

    if (video) {
      setPlaybackBlocked(false);
      video.srcObject = stream;
      video.volume = volume;
      void startPlayback(video, local || muted, hasAudio, () => (
        active && video.srcObject === stream
      ), (blocked) => {
        if (active) setAudioBlocked(blocked);
      }, (blocked) => {
        if (active) setPlaybackBlocked(blocked);
      });
    }

    return () => {
      active = false;
      if (video?.srcObject === stream) video.srcObject = null;
    };
  }, [hasAudio, stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    const shouldMute = local || muted || audioBlocked;
    video.volume = volume;
    video.muted = shouldMute;

    if (!local && hasAudio && !shouldMute) {
      void video.play().catch((error: unknown) => {
        if (active && video.srcObject === stream && isNotAllowedError(error)) {
          video.muted = true;
          setAudioBlocked(true);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [audioBlocked, hasAudio, local, muted, stream, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    let resumeTimer: number | null = null;
    const isCurrent = () => (
      active
      && document.visibilityState === "visible"
      && video.srcObject === stream
      && stream.getVideoTracks().some((track) => track.readyState !== "ended")
    );
    const resumePlayback = () => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);

      resumeTimer = window.setTimeout(() => {
        resumeTimer = null;
        if (!isCurrent() || !video.paused) return;

        const shouldMute = local || muted || audioBlocked;
        video.volume = volume;
        video.muted = shouldMute;

        void video.play().then(
          () => {
            if (isCurrent()) setPlaybackBlocked(false);
          },
          async (error: unknown) => {
            if (!isCurrent()) return;

            if (!shouldMute && hasAudio && isNotAllowedError(error)) {
              video.muted = true;
              setAudioBlocked(true);

              try {
                await video.play();
                if (isCurrent()) setPlaybackBlocked(false);
              } catch {
                if (isCurrent()) setPlaybackBlocked(true);
              }
              return;
            }

            setPlaybackBlocked(true);
          },
        );
      }, 0);
    };
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible" && video.paused) resumePlayback();
    };

    video.addEventListener("pause", resumePlayback);
    video.addEventListener("webkitendfullscreen", resumePlayback);
    document.addEventListener("visibilitychange", resumeWhenVisible);

    return () => {
      active = false;
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);
      video.removeEventListener("pause", resumePlayback);
      video.removeEventListener("webkitendfullscreen", resumePlayback);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [audioBlocked, hasAudio, local, muted, stream, volume]);

  const hearAudio = async () => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = false;

    try {
      await video.play();
      setAudioBlocked(false);
      setPlaybackBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  };

  const retryPlayback = async () => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = local || muted || audioBlocked;

    try {
      await video.play();
      setPlaybackBlocked(false);
    } catch {
      setPlaybackBlocked(true);
    }
  };

  return (
    <article
      ref={tileRef}
      className={`video-tile ${isFullscreen ? "fullscreen-tile" : ""} ${!controlsVisible ? "controls-hidden" : ""}`}
      data-peer-id={fullscreenId}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") {
          revealControls();
          if (isFullscreen) scheduleControlsHide();
        }
      }}
      onPointerMove={(event) => {
        if (isFullscreen && event.pointerType !== "touch") {
          revealControls();
          scheduleControlsHide();
        } else if (!controlsVisible && event.pointerType !== "touch") {
          revealControls();
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") scheduleControlsHide();
      }}
      onPointerDown={(event) => {
        if (isFullscreen && event.pointerType !== "touch") {
          revealControls();
          scheduleControlsHide();
          return;
        }
        if (event.pointerType !== "touch" || (event.target instanceof Element && event.target.closest("button, input"))) return;
        clearControlsTimer();
        setControlsVisible((visible) => !visible);
      }}
      onFocusCapture={revealControls}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(".tile-controls")) scheduleControlsHide();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && (isFullscreen || !event.currentTarget.matches(":hover"))) scheduleControlsHide();
      }}
    >
      <video ref={videoRef} autoPlay playsInline muted={local || muted || audioBlocked} />
      {!local && (
        <VideoLoadingOverlay
          phase={playbackPhase}
          connectionState={state}
          playbackBlocked={playbackBlocked}
          onRetryPlayback={() => void retryPlayback()}
        />
      )}
      {!local && hasAudio && audioBlocked && !muted && (
        <button type="button" className="audio-playback-action" onClick={() => void hearAudio()}>
          Tap to hear shared audio
        </button>
      )}
      <div className="video-meta">
        <span className="live-dot" />
        <strong>{local ? "Your screen" : `${name}'s screen`}</strong>
        {local && qualityLabel && <span className="peer-state">{qualityLabel}</span>}
        {state && <span className="peer-state">{state}</span>}
      </div>
      {!local && stats && <StreamStats stats={stats} />}
      {local && statsEnabled && outboundStats.length > 0 && (
        <StreamStats outbound={outboundStats} />
      )}
      {((local && onToggleStats) ||
        (!local && (onVolumeChange || onToggleStats || onFullscreen))) && (
        <div className="tile-controls">
          {onToggleStats && <StatsButton statsEnabled={statsEnabled} toggleStats={onToggleStats} />}
          {onVolumeChange && onToggleMute && (
            <VolumeControl
              volume={volume}
              muted={muted}
              disabled={!hasAudio}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />
          )}
          {onFullscreen && (
            <button
              className="icon-button"
              onClick={() => {
                if (videoRef.current && tileRef.current) onFullscreen(videoRef.current, tileRef.current);
              }}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
