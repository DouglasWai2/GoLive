import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Peer, PeerConnectionState, RemoteVideoStats, SocketStatus } from "../../types";
import { MicrophoneIcon, MicrophoneMutedIcon, ScreenIcon, UsersIcon } from "../icons";
import { LOCAL_SPEAKER_ID } from "../../hooks/useSpeakingPeers";
import { VideoTile } from "../VideoTile";

type ParticipantsGridProps = {
  displayMode: "grid" | "stage" | "preview" | "hidden";
  localName: string;
  localStream: MediaStream | null;
  localViewerCount: number;
  localMicMuted: boolean;
  peers: Peer[];
  focusedPeerId: string | null;
  focusedStream: MediaStream | null;
  focusedConnectionState?: PeerConnectionState;
  focusedStats: RemoteVideoStats | null;
  hideFocusedVideo: boolean;
  statsEnabled: boolean;
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleStats: () => void;
  onLocalFullscreen: (video: HTMLVideoElement, tile: HTMLElement) => void;
  onRemoteFullscreen: (video: HTMLVideoElement, tile: HTMLElement) => void;
  fullscreenPeerId: string | null;
  speakingPeerIds: Set<string>;
  status: SocketStatus;
  onFocusPeer: (peerId: string) => void;
  onFocusLocal: () => void;
  onOpenParticipants: (returnFocusTo: HTMLButtonElement) => void;
  onMinimizeRemote: () => void;
  onStopWatchingRemote: () => void;
};

export function ParticipantsGrid({ displayMode, localName, localStream, localViewerCount, localMicMuted, peers, focusedPeerId, focusedStream, focusedConnectionState, focusedStats, hideFocusedVideo, statsEnabled, volume, muted, onVolumeChange, onToggleMute, onToggleStats, onLocalFullscreen, onRemoteFullscreen, fullscreenPeerId, speakingPeerIds, status, onFocusPeer, onFocusLocal, onOpenParticipants, onMinimizeRemote, onStopWatchingRemote }: ParticipantsGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const previousPositions = useRef<Map<string, DOMRect>>(new Map());
  const animations = useRef<Map<string, Animation>>(new Map());
  const participants = [
    { id: LOCAL_SPEAKER_ID, name: localName, sharing: Boolean(localStream), micMuted: localMicMuted, voiceJoined: true, local: true },
    ...peers.map((peer) => ({
      id: peer.id,
      name: peer.name,
      sharing: peer.sharing && Boolean(peer.streamId),
      micMuted: peer.micMuted,
      voiceJoined: peer.voiceJoined,
      local: false,
    })),
  ];
  const hiddenCount = participants.length > 9 ? participants.length - 8 : 0;
  const visible = hiddenCount ? participants.slice(0, 8) : participants;
  if (hiddenCount && focusedPeerId && !visible.some((participant) => participant.id === focusedPeerId)) {
    const watched = participants.find((participant) => participant.id === focusedPeerId);
    if (watched) visible[7] = watched;
  }
  const slots = visible.length + Number(hiddenCount > 0);
  const columns = Math.min(3, Math.ceil(Math.sqrt(slots)));
  const rows = Math.ceil(slots / columns);
  const layoutKey = `${columns}:${visible.map((participant) => participant.id).join(",")}:${hiddenCount}`;

  useLayoutEffect(() => {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-grid-id]");
    if (!cards) return;

    const next = new Map<string, DOMRect>();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const card of cards) {
      const id = card.dataset.gridId;
      if (!id) continue;
      const interrupted = animations.current.get(id);
      const currentPosition = interrupted ? card.getBoundingClientRect() : null;
      interrupted?.cancel();
      animations.current.delete(id);
      const rect = card.getBoundingClientRect();
      next.set(id, rect);
      const previous = currentPosition ?? previousPositions.current.get(id);
      if (!previous || reduceMotion || typeof card.animate !== "function") continue;

      const dx = previous.left - rect.left;
      const dy = previous.top - rect.top;
      const sx = previous.width / rect.width;
      const sy = previous.height / rect.height;
      if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) + Math.abs(sy - 1) < 0.01) continue;
      const animation = card.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: "translate(0, 0) scale(1)" },
      ], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
      animations.current.set(id, animation);
      void animation.finished.then(() => {
        if (animations.current.get(id) === animation) animations.current.delete(id);
      }).catch(() => {});
    }
    for (const [id, animation] of animations.current) {
      if (!next.has(id)) {
        animation.cancel();
        animations.current.delete(id);
      }
    }
    previousPositions.current = next;
  }, [layoutKey]);

  useLayoutEffect(() => () => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  }, []);

  return (
    <div className="participant-grid-wrap">
      {status !== "connected" && <p className="participant-grid-status" role="status">{status === "disconnected" ? "Connection lost · leave and rejoin" : "Reconnecting…"}</p>}
      <div
        ref={gridRef}
        className="participant-grid"
        data-count={slots}
        data-display={displayMode}
        aria-label="People in the call"
        style={{ "--participant-columns": columns, "--participant-rows": rows } as CSSProperties}
      >
        {visible.map((participant) => {
          const speaking = participant.voiceJoined && !participant.micMuted && speakingPeerIds.has(participant.id);
          const voiceStatus = !participant.voiceJoined ? "No voice" : participant.micMuted ? "Microphone muted" : speaking ? "Speaking" : "Microphone on";
          const isFocusedRemote = !participant.local && participant.id === focusedPeerId;
          const thumbnail = participant.local
            ? displayMode === "grid" ? localStream : null
            : isFocusedRemote && !hideFocusedVideo ? focusedStream : null;
          const remoteDisplayMode = isFocusedRemote && (displayMode === "stage" || displayMode === "preview");
          const videoVariant = isFocusedRemote && displayMode === "stage"
            ? "stage"
            : isFocusedRemote && displayMode === "preview"
              ? "preview"
              : "card";
          const focus = () => participant.local ? onFocusLocal() : onFocusPeer(participant.id);
          const focusLabel = participant.local
            ? "Show your screen on stage"
            : `${isFocusedRemote ? "Focus" : "Watch"} ${participant.name}'s screen`;
          const contents = (
            <>
              {thumbnail ? (
                <VideoTile
                  stream={thumbnail}
                  name={participant.name}
                  local={participant.local}
                  viewerCount={participant.local ? localViewerCount : undefined}
                  state={isFocusedRemote ? focusedConnectionState : undefined}
                  stats={isFocusedRemote && statsEnabled ? focusedStats : null}
                  statsEnabled={statsEnabled}
                  variant={videoVariant}
                  volume={volume}
                  muted={muted}
                  fullscreenId={participant.local ? "local" : participant.id}
                  isFullscreen={fullscreenPeerId === (participant.local ? "local" : participant.id)}
                  onVolumeChange={participant.local ? undefined : onVolumeChange}
                  onToggleMute={participant.local ? undefined : onToggleMute}
                  onToggleStats={onToggleStats}
                  onFullscreen={participant.local ? onLocalFullscreen : onRemoteFullscreen}
                  onMinimize={remoteDisplayMode && displayMode === "stage" ? onMinimizeRemote : undefined}
                  onStopWatching={remoteDisplayMode ? onStopWatchingRemote : undefined}
                />
              ) : <span className="grid-person-avatar" aria-hidden="true">{participant.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="grid-person-voice" title={voiceStatus} aria-label={voiceStatus} role="img">
                      {participant.voiceJoined && !participant.micMuted ? <MicrophoneIcon size={15} /> : <MicrophoneMutedIcon size={15} />}
                    </span>
              {participant.sharing && <span className="grid-person-live" aria-label={participant.local ? "Sharing your screen" : isFocusedRemote ? "Screen being watched" : "Sharing screen"}><ScreenIcon size={15} /> {participant.local ? "SHARING" : isFocusedRemote ? focusedStream ? "WATCHING" : "CONNECTING" : "SHARING"}</span>}
              {participant.sharing ? (
                <button type="button" className="grid-person-focus" onClick={focus} aria-label={focusLabel} title={focusLabel}>
                  <span className="grid-person-name">{participant.name}{participant.local ? " (you)" : ""}</span>
                  <ScreenIcon size={16} />
                </button>
              ) : <span className="grid-person-label"><span className="grid-person-name">{participant.name}{participant.local ? " (you)" : ""}</span></span>}

            </>
          );
          const className = `participant-grid-card ${speaking ? "is-speaking" : ""} ${participant.sharing ? "is-sharing" : ""} ${isFocusedRemote ? "is-focused-remote" : ""} ${thumbnail ? "has-thumbnail" : ""}`;

          return participant.sharing ? (
            <div
              className={className}
              key={participant.id}
              data-grid-id={participant.id}
              onClick={(event) => {
                if (fullscreenPeerId === (participant.local ? "local" : participant.id)) return;
                if (event.target instanceof Element && event.target.closest("button, input")) return;
                focus();
              }}
              title={`${focusLabel}${speaking ? " · speaking" : ""}`}
            >{contents}</div>
          ) : (
              <div className={className} key={participant.id} data-grid-id={participant.id} role="group" aria-label={`${participant.name}${participant.local ? ", you" : ""}, ${voiceStatus.toLowerCase()}, not sharing a screen`}>
                {contents}
              </div>
          );
        })}
        {hiddenCount > 0 && (
          <button type="button" className="participant-grid-card participant-grid-more" data-grid-id="__more__" onClick={(event) => onOpenParticipants(event.currentTarget)} aria-label={`Show ${hiddenCount} more people in the call`} title="Show all people">
            <UsersIcon size={24} /><strong>+{hiddenCount}</strong><span>More people</span>
          </button>
        )}
      </div>
    </div>
  );
}
