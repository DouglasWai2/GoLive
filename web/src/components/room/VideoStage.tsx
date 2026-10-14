import { useEffect, useRef, useState } from "react";
import { EyeOffIcon, FullscreenExitIcon, ScreenIcon } from "../icons";
import { VideoTile } from "../VideoTile";
import { StreamStats } from "./StreamStats";
import { ParticipantsPanel, type ParticipantsPanelHandle } from "./ParticipantsPanel";
import { ParticipantsGrid } from "./ParticipantsGrid";
import type {
  CallStageSource,
  OutboundVideoStats,
  Peer,
  PeerConnectionState,
  RemoteVideoStats,
  SocketStatus,
  VoicePlaybackSettings,
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
import { useVideoPlaybackState } from "../../hooks/useVideoPlaybackState";
import { VideoLoadingOverlay } from "../VideoLoadingOverlay";

type VideoStageProps = {
  localStream: MediaStream | null;
  peers: Peer[];
  focusedPeerId: string | null;
  onFocusPeer: (peerId: string) => void;
  onStopWatchingRemote: () => void;
  stageSource: CallStageSource;
  onStageSourceChange: (source: CallStageSource) => void;
  remoteStreams: Record<string, MediaStream>;
  connectionStates: Record<string, PeerConnectionState>;
  remoteStats: Record<string, RemoteVideoStats | null>;
  outboundStats: Record<string, OutboundVideoStats>;
  localQuality: string | null;
  localName: string;
  status: SocketStatus;
  localMicMuted: boolean;
  deafened: boolean;
  voicePlaybackSettings: Record<string, VoicePlaybackSettings>;
  speakingPeerIds: Set<string>;
  onVoiceVolumeChange: (peerId: string, volume: number) => void;
  onTogglePeerVoiceMute: (peerId: string) => void;
  onLeaveDisconnected: () => void;
};

const STATS_STORAGE_KEY = "golive.stats.enabled";
const VOLUME_STORAGE_KEY = "golive.volume";
const MUTED_STORAGE_KEY = "golive.muted";

function isNotAllowedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function VideoStage({ localStream, peers, focusedPeerId, onFocusPeer, onStopWatchingRemote, stageSource, onStageSourceChange, remoteStreams, connectionStates, remoteStats, outboundStats, localQuality, localName, status, localMicMuted, deafened, voicePlaybackSettings, speakingPeerIds, onVoiceVolumeChange, onTogglePeerVoiceMute, onLeaveDisconnected }: VideoStageProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenPeerId, setFullscreenPeerId] = useState<string | null>(null);
  const [showCinemaControls, setShowCinemaControls] = useState(false);
  const [cinemaAudioBlocked, setCinemaAudioBlocked] = useState(false);
  const [cinemaPlaybackBlocked, setCinemaPlaybackBlocked] = useState(false);
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
  const participantsPanelRef = useRef<ParticipantsPanelHandle>(null);

  const activeSharers = peers.filter((peer) => peer.sharing && Boolean(peer.streamId));
  const focusedPeer = activeSharers.find((peer) => peer.id === focusedPeerId);
  const focusedStreamId = focusedPeer?.streamId ?? null;
  const focusedStream = focusedStreamId ? remoteStreams[focusedStreamId] ?? null : null;
  const cinemaPeer = focusedStream ? focusedPeer : undefined;
  const cinemaStream = focusedStream;
  const cinemaHasAudio = Boolean(cinemaStream?.getAudioTracks().length);
  const cinemaName = cinemaPeer?.name ?? "";
  const cinemaStats = focusedStreamId ? remoteStats[focusedStreamId] ?? null : null;
  const cinemaConnectionState = focusedStreamId ? connectionStates[focusedStreamId] : undefined;
  const cinemaPlaybackPhase = useVideoPlaybackState(
    cinemaVideoRef,
    cinemaStream,
    isFullscreen && Boolean(cinemaStream),
  );
  const localOutboundStats = peers.flatMap((peer) => {
    const stats = outboundStats[peer.id];
    return stats ? [{ peerId: peer.id, peerName: peer.name, stats }] : [];
  });
  const mainSource: "local" | "remote" | null = stageSource === "none"
    ? null
    : stageSource === "local" && localStream
      ? "local"
      : focusedPeer
        ? "remote"
        : null;
  const showParticipantGrid = mainSource === null;
  const previewSource: "local" | "remote" | null = mainSource === "local" && focusedPeer
    ? "remote"
    : mainSource === "remote" && localStream
      ? "local"
      : null;
  const emptyTitle =
    status === "reconnecting"
      ? "Reconnecting to the room..."
      : status === "disconnected"
        ? "Connection lost"
        : `Connecting to ${focusedPeer?.name ?? "the selected"} screen...`;
  const emptyMessage =
    status === "reconnecting"
      ? "Your session will resume automatically when the connection returns."
      : status === "disconnected"
        ? "Leave and rejoin the room to start a new session."
        : "Connecting to the selected screen. You can stop watching at any time.";

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
      const element = getFullscreenElement();
      setIsFullscreen(element === cinemaRef.current);
      setFullscreenPeerId(element instanceof HTMLElement ? element.dataset.peerId ?? null : null);
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
      setCinemaPlaybackBlocked(false);
      video.volume = volume;
      video.muted = muted;
      video.srcObject = cinemaStream;

      void video.play().then(
        () => {
          if (active && video.srcObject === cinemaStream) {
            setCinemaAudioBlocked(false);
            setCinemaPlaybackBlocked(false);
          }
        },
        async (error: unknown) => {
          if (!active || video.srcObject !== cinemaStream) {
            return;
          }

          if (!isNotAllowedError(error)) {
            return;
          }

          video.muted = true;
          if (active) setCinemaAudioBlocked(cinemaHasAudio && !muted);

          try {
            await video.play();
            if (active && video.srcObject === cinemaStream) {
              setCinemaPlaybackBlocked(false);
            }
          } catch {
            if (active && video.srcObject === cinemaStream) {
              setCinemaPlaybackBlocked(true);
            }
          }
        },
      );
    } else {
      video.srcObject = null;
      setCinemaAudioBlocked(false);
      setCinemaPlaybackBlocked(false);
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
    document.addEventListener("mozfullscreenchange", fitNextFrame);

    return () => {
      video.style.width = "";
      video.style.height = "";
      video.removeEventListener("resize", fit);
      video.removeEventListener("loadedmetadata", fit);
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", fitNextFrame);
      document.removeEventListener("mozfullscreenchange", fitNextFrame);
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
      setCinemaPlaybackBlocked(false);
    } catch {
      setCinemaAudioBlocked(true);
    }
  };

  const retryCinemaPlayback = async () => {
    const video = cinemaVideoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = muted || cinemaAudioBlocked;

    try {
      await video.play();
      setCinemaPlaybackBlocked(false);
    } catch {
      setCinemaPlaybackBlocked(true);
    }
  };

  const toggleFullscreen = async (sourceVideo: HTMLVideoElement, tile: HTMLElement) => {
    if (getFullscreenElement()) {
      await exitFullscreen();
      return;
    }

    // iPhone Safari: fullscreen the original video element to avoid
    // black-screen when a second video clones the WebRTC stream.
    if (/iPhone/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent)) {
      try {
        await requestVideoFullscreen(sourceVideo);
        return;
      } catch (caught) {
        console.warn("Could not enter fullscreen video mode on iPhone", caught);
      }
      return;
    }

    // Firefox can render a second video for the same WebRTC stream black in
    // fullscreen. Keep the active tile as its fullscreen video on that browser.
    if (/Firefox\//.test(navigator.userAgent) && isElementFullscreenSupported()) {
      try {
        await requestFullscreen(tile);
        return;
      } catch {
        // Fall back to the native video fullscreen API below.
      }
    }

    const userAgent = navigator.userAgent;
    const isChrome = /Chrome\//.test(userAgent)
      && !/(?:Edg|OPR|Chromium|SamsungBrowser|Vivaldi|YaBrowser)\//.test(userAgent)
      && !("brave" in navigator);
    if (isChrome && isElementFullscreenSupported()) {
      // Chrome can render a second video for the same WebRTC stream black in
      // fullscreen. Keep the active tile as its fullscreen video on Chrome.
      try {
        await requestFullscreen(tile);
        return;
      } catch {
        // Fall back to the cinema video if tile fullscreen is unavailable.
      }
    }

    if (!isElementFullscreenSupported()) {
      try {
        await requestVideoFullscreen(sourceVideo);
      } catch (caught) {
        console.warn("Could not enter fullscreen video mode", caught);
      }
      return;
    }

    if (!cinemaRef.current) return;

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

  const toggleLocalFullscreen = async (sourceVideo: HTMLVideoElement, tile: HTMLElement) => {
    if (getFullscreenElement()) {
      await exitFullscreen();
      return;
    }

    if (/iPhone/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent)) {
      try {
        await requestVideoFullscreen(sourceVideo);
        return;
      } catch (caught) {
        console.warn("Could not enter fullscreen video mode on iPhone", caught);
      }
    }

    if (isElementFullscreenSupported()) {
      try {
        await requestFullscreen(tile);
        return;
      } catch {
        // Fall back to the native video fullscreen API below.
      }
    }

    try {
      await requestVideoFullscreen(sourceVideo);
    } catch (caught) {
      console.warn("Could not enter fullscreen video mode", caught);
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
          <h1 aria-live="polite">
            {stageSource === "none" && focusedPeer
              ? `${focusedPeer.name} · preview`
              : mainSource === "local"
                ? "Your screen"
                : focusedPeer
                  ? focusedPeer.name
                  : "Call"}
          </h1>
        </div>
        <ParticipantsPanel
          ref={participantsPanelRef}
          localName={localName}
          localStream={localStream}
          peers={peers}
          focusedPeerId={focusedPeerId}
          stageSource={mainSource}
          localMicMuted={localMicMuted}
          deafened={deafened}
          voicePlaybackSettings={voicePlaybackSettings}
          screenVolume={volume}
          screenMuted={muted}
          screenHasAudio={cinemaHasAudio}
          speakingPeerIds={speakingPeerIds}
          onFocusPeer={onFocusPeer}
          onStageSourceChange={onStageSourceChange}
          onVoiceVolumeChange={onVoiceVolumeChange}
          onTogglePeerVoiceMute={onTogglePeerVoiceMute}
          onScreenVolumeChange={changeVolume}
          onToggleScreenMute={toggleMute}
          onStopWatchingRemote={onStopWatchingRemote}
        />
      </div>

      <div className={`video-grid call-canvas ${previewSource ? "has-preview" : ""}`}>
        <div className={`call-stage-main ${showParticipantGrid ? "is-people" : ""}`} key={showParticipantGrid ? "people" : mainSource === "remote" ? `remote-${focusedPeerId}` : mainSource ?? "empty"}>
          {showParticipantGrid && (
            <ParticipantsGrid
              localName={localName}
              localStream={localStream}
              localMicMuted={localMicMuted}
              peers={peers}
              focusedPeerId={focusedPeerId}
              focusedStream={focusedStream}
              focusedConnectionState={cinemaConnectionState}
              hideFocusedVideo={isFullscreen}
              focusedStats={statsEnabled && focusedStreamId ? remoteStats[focusedStreamId] ?? null : null}
              volume={volume}
              muted={muted}
              statsEnabled={statsEnabled}
              onVolumeChange={changeVolume}
              onToggleMute={toggleMute}
              onToggleStats={toggleStats}
              onLocalFullscreen={(video, tile) => void toggleLocalFullscreen(video, tile)}
              onRemoteFullscreen={(video, tile) => void toggleFullscreen(video, tile)}
              fullscreenPeerId={fullscreenPeerId}
              speakingPeerIds={speakingPeerIds}
              status={status}
              onFocusPeer={onFocusPeer}
              onFocusLocal={() => onStageSourceChange("local")}
              onOpenParticipants={() => participantsPanelRef.current?.open()}
            />
          )}
          {mainSource === "local" && localStream && (
            <VideoTile
              key="local-stage"
              stream={localStream}
              name={localName}
              local
              qualityLabel={localQuality}
              outboundStats={localOutboundStats}
              statsEnabled={statsEnabled}
              fullscreenId="local"
              isFullscreen={fullscreenPeerId === "local"}
              onToggleStats={toggleStats}
              onFullscreen={(video, tile) => void toggleLocalFullscreen(video, tile)}
              onMinimize={() => onStageSourceChange("none")}
            />
          )}
          {mainSource === "remote" && focusedStream && focusedPeer && (!isFullscreen || focusedPeer.id !== cinemaPeer?.id) && (
            <VideoTile
              key={focusedPeer.id}
              stream={focusedStream}
              name={focusedPeer.name}
              state={focusedStreamId ? connectionStates[focusedStreamId] : undefined}
              stats={statsEnabled && focusedStreamId ? remoteStats[focusedStreamId] ?? null : null}
              volume={volume}
              muted={muted}
              statsEnabled={statsEnabled}
              fullscreenId={focusedPeer.id}
              isFullscreen={fullscreenPeerId === focusedPeer.id}
              onVolumeChange={changeVolume}
              onToggleMute={toggleMute}
              onToggleStats={toggleStats}
              onFullscreen={(video, tile) => void toggleFullscreen(video, tile)}
              onMinimize={() => onStageSourceChange("none")}
              onStopWatching={onStopWatchingRemote}
            />
          )}
          {mainSource === "remote" && !focusedStream && (
            <>
              <div className="empty-stage">
                <div className="screen-outline"><ScreenIcon size={38} /><span className="scan-line" /></div>
                <h2>{emptyTitle}</h2>
                {emptyMessage && <p>{emptyMessage}</p>}
                {status === "disconnected" && <button className="leave-button empty-leave-button" type="button" onClick={onLeaveDisconnected}>Leave room</button>}
              </div>
              <button type="button" className="empty-stop-watching icon-button" onClick={onStopWatchingRemote} title={`Stop watching ${focusedPeer?.name ?? "screen"}`} aria-label={`Stop watching ${focusedPeer?.name ?? "screen"}`}><EyeOffIcon /></button>
            </>
          )}
        </div>

        {previewSource === "local" && localStream && (
          <div className="call-stage-preview local-preview" key="local-preview">
            <VideoTile
              key="local-preview"
              stream={localStream}
              name={localName}
              local
              qualityLabel={localQuality}
              outboundStats={localOutboundStats}
              statsEnabled={statsEnabled}
              fullscreenId="local"
              isFullscreen={fullscreenPeerId === "local"}
              variant="preview"
              onToggleStats={toggleStats}
              onFullscreen={(video, tile) => void toggleLocalFullscreen(video, tile)}
            />
          </div>
        )}
        {previewSource === "remote" && focusedPeer && (!isFullscreen || focusedPeer.id !== cinemaPeer?.id) && (
          <div className={`call-stage-preview ${focusedStream ? "" : "preview-loading"}`} key={focusedPeer.id}>
            {focusedStream ? (
              <VideoTile
                key={focusedPeer.id}
                stream={focusedStream}
                name={focusedPeer.name}
                state={focusedStreamId ? connectionStates[focusedStreamId] : undefined}
                volume={volume}
                muted={muted}
                statsEnabled={statsEnabled}
                fullscreenId={focusedPeer.id}
                isFullscreen={fullscreenPeerId === focusedPeer.id}
                variant="preview"
                onVolumeChange={changeVolume}
                onToggleMute={toggleMute}
                onFullscreen={(video, tile) => void toggleFullscreen(video, tile)}
                onStopWatching={onStopWatchingRemote}
              />
            ) : (
              <div className="preview-wait" role="status">
                <ScreenIcon size={18} />
                <span>Connecting to {focusedPeer.name}'s screen…</span>
              </div>
            )}
            {!focusedStream && <button type="button" className="preview-stop-watching icon-button" onClick={onStopWatchingRemote} title={`Stop watching ${focusedPeer.name}'s screen`} aria-label={`Stop watching ${focusedPeer.name}'s screen`}><EyeOffIcon /></button>}
          </div>
        )}
      </div>
      <div
        className={`cinema ${isFullscreen && !showCinemaControls ? "controls-hidden" : ""}`}
        ref={cinemaRef}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") revealCinemaControls();
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          if (event.target instanceof Element && event.target.closest("button, input")) {
            revealCinemaControls();
          } else {
            setShowCinemaControls((visible) => !visible);
            clearCinemaControlsTimer();
          }
        }}
      >
        <video ref={cinemaVideoRef} autoPlay playsInline />
        {isFullscreen && cinemaStream && (
          <VideoLoadingOverlay
            phase={cinemaPlaybackPhase}
            connectionState={cinemaConnectionState}
            playbackBlocked={cinemaPlaybackBlocked}
            onRetryPlayback={() => void retryCinemaPlayback()}
          />
        )}
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
          <VolumeControl
            volume={volume}
            muted={muted}
            disabled={!cinemaHasAudio}
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
          />
          <button type="button" className="icon-button" onClick={() => void exitFullscreen()} title="Exit fullscreen" aria-label="Exit fullscreen">
            <FullscreenExitIcon />
          </button>
        </div>
      </div>
    </section>
  );
}
