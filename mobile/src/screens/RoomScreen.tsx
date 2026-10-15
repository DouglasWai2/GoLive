import { useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildInviteUrl, createInvite, formatBitrate, formatResolution } from "@golive/core";
import type { ShareSettings } from "@golive/core";
import { useRoom } from "../hooks/useRoom";
import { Brand } from "../components/Brand";
import { CloseIcon, ScreenIcon, ShareIcon, UsersIcon } from "../components/icons";
import { VideoTile } from "../components/VideoTile";
import { ShareSheet } from "../components/ShareSheet";
import { ControlDock } from "../components/ControlDock";
import { FullscreenView } from "../components/FullscreenView";
import { VoiceAudio } from "../components/VoiceAudio";
import { INVITE_BASE_URL, SIGNALING_URL } from "../config";
import { colors, radii, technicalText } from "../theme";
import { ParticipantsList } from "../components/ParticipantsList";
import { ParticipantsGrid } from "../components/ParticipantsGrid";

const STATS_STORAGE_KEY = "golive.stats.enabled";
const VOLUME_STORAGE_KEY = "golive.volume";
const MUTED_STORAGE_KEY = "golive.muted";

type RoomScreenProps = {
  roomId: string;
  name: string;
  token: string;
  onLeave: () => void;
  onLeaveDisconnected: () => void;
  onSessionRejected: () => void;
  onSessionReplaced: () => void;
};

export function RoomScreen({
  roomId,
  name,
  token,
  onLeave,
  onLeaveDisconnected,
  onSessionRejected,
  onSessionReplaced,
}: RoomScreenProps) {
  const [shareVisible, setShareVisible] = useState(false);
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [participantsVisible, setParticipantsVisible] = useState(false);

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [audioPreferencesReady, setAudioPreferencesReady] = useState(false);
  const [statsEnabled, setStatsEnabled] = useState(true);
  const [fullscreenTarget, setFullscreenTarget] = useState<
    { type: "local" } | { type: "remote"; peerId: string } | null
  >(null);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const [stoppedWatchingRemote, setStoppedWatchingRemote] = useState(false);
  const [stageSource, setStageSource] = useState<"local" | "remote" | "none">("remote");
  const [deafened, setDeafened] = useState(false);
  const { width } = useWindowDimensions();
  const compactHeader = width < 390;

  const {
    status,
    peers,
    localStream,
    isStartingShare,
    remoteStreams,
    remoteStats,
    outboundStats,
    connectionStates,
    error,
    voiceState,
    remoteVoiceTracks,
    setError,
    startSharing,
    stopSharing,
    focusPeer: setFocusedRemotePeer,
    setMicrophoneMuted,
    playNotificationSound,
  } = useRoom(roomId, name, token, onSessionRejected, onSessionReplaced);

  useEffect(() => {
    void (async () => {
      try {
        const [statsRaw, volumeRaw, mutedRaw] = await Promise.all([
          AsyncStorage.getItem(STATS_STORAGE_KEY),
          AsyncStorage.getItem(VOLUME_STORAGE_KEY),
          AsyncStorage.getItem(MUTED_STORAGE_KEY),
        ]);

        if (statsRaw !== null) setStatsEnabled(statsRaw !== "0");
        const storedVolume = Number(volumeRaw);
        if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 1) setVolume(storedVolume);
        if (mutedRaw !== null) setMuted(mutedRaw === "1");
      } catch {
        // Keep the safe defaults when stored preferences cannot be read.
      } finally {
        setAudioPreferencesReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!localStream && !isStartingShare) setShareSettings(null);
  }, [localStream, isStartingShare]);

  useEffect(() => {
    const activeSharers = peers.filter((peer) => peer.sharing && peer.streamId);
    if (activeSharers.length === 0) {
      setFocusedPeerId(null);
      setStoppedWatchingRemote(false);
      return;
    }
    if (stoppedWatchingRemote) return;
    if (focusedPeerId && activeSharers.some((peer) => peer.id === focusedPeerId)) return;
    setFocusedPeerId(activeSharers[0].id);
  }, [focusedPeerId, peers, stoppedWatchingRemote]);

  useEffect(() => {
    setFocusedRemotePeer(focusedPeerId);
  }, [focusedPeerId, setFocusedRemotePeer]);

  useEffect(() => {
    if (!fullscreenTarget) return;
    if (fullscreenTarget.type === "local") {
      if (!localStream) setFullscreenTarget(null);
      return;
    }

    const fullscreenPeer = peers.find((peer) => peer.id === fullscreenTarget.peerId);
    if (!fullscreenPeer?.streamId || !remoteStreams[fullscreenPeer.streamId]) {
      setFullscreenTarget(null);
    }
  }, [fullscreenTarget, localStream, peers, remoteStreams]);

  useEffect(() => {
    const streamVolume = audioPreferencesReady && !muted ? volume : 0;

    for (const stream of Object.values(remoteStreams)) {
      for (const track of stream.getAudioTracks()) {
        (track as typeof track & { _setVolume?: (volume: number) => void })
          ._setVolume?.(streamVolume);
      }
    }
  }, [audioPreferencesReady, muted, remoteStreams, volume]);

  const changeVolume = (next: number) => {
    setVolume(next);
    AsyncStorage.setItem(VOLUME_STORAGE_KEY, String(next)).catch(() => {});
    if (next > 0) {
      setMuted(false);
      AsyncStorage.setItem(MUTED_STORAGE_KEY, "0").catch(() => {});
    }
  };

  const toggleMute = () => {
    setMuted((current) => {
      const next = !current;
      AsyncStorage.setItem(MUTED_STORAGE_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
  };

  const toggleStats = () => {
    setStatsEnabled((current) => {
      const next = !current;
      AsyncStorage.setItem(STATS_STORAGE_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
  };

  const activeSharers = peers.filter((peer) => peer.sharing && Boolean(peer.streamId));
  const focusedPeer = activeSharers.find((peer) => peer.id === focusedPeerId);
  const focusedStreamId = focusedPeer?.streamId ?? null;
  const focusedStream = focusedStreamId ? remoteStreams[focusedStreamId] ?? null : null;
  const mainSource: "local" | "remote" | null = stageSource === "none"
    ? null
    : stageSource === "local" && localStream
      ? "local"
      : focusedPeer
        ? "remote"
        : null;
  const previewSource: "local" | "remote" | null = mainSource === "local" && focusedPeer
    ? "remote"
    : mainSource === "remote" && localStream
      ? "local"
      : null;
  const fullscreenPeer = fullscreenTarget?.type === "remote"
    ? peers.find((peer) => peer.id === fullscreenTarget.peerId)
    : undefined;
  const fullscreenStreamId = fullscreenPeer?.streamId ?? null;
  const fullscreenStream = fullscreenTarget?.type === "local"
    ? localStream
    : fullscreenStreamId
      ? remoteStreams[fullscreenStreamId] ?? null
      : null;
  const localOutboundStats = peers.flatMap((peer) => {
    const stats = outboundStats[peer.id];
    return stats ? [{ peerId: peer.id, peerName: peer.name, stats }] : [];
  });
  const localQuality = localStream && shareSettings
    ? `${formatResolution(shareSettings.width, shareSettings.height)} · ${shareSettings.frameRate} fps · ${formatBitrate(shareSettings.maxBitrate)} · ${localStream.getAudioTracks().length > 0 ? "Audio on" : "No audio"}`
    : null;

  const handleStart = (settings: ShareSettings) => {
    setShareSettings(settings);
    setShareVisible(false);
    startSharing(settings);
  };

  const toggleDeafen = () => {
    const nextDeafened = !deafened;
    setDeafened(nextDeafened);
    playNotificationSound(nextDeafened ? "deafen" : "undeafen");
  };

  const handleInvite = async () => {
    if (isInviting) return;
    setIsInviting(true);
    setError("");

    try {
      const inviteToken = await createInvite(SIGNALING_URL, roomId, token);
      const link = buildInviteUrl(INVITE_BASE_URL, roomId, inviteToken);
      await Share.share({ message: link });
    } catch {
      setError("Could not create an invite link.");
    } finally {
      setIsInviting(false);
    }
  };

  const stageTitle = mainSource === "local"
    ? "You are presenting"
    : mainSource === "remote" && focusedPeer
      ? `Watching ${focusedPeer.name}`
      : activeSharers.length > 0
        ? "Choose a screen"
        : localStream
          ? "Your screen is ready"
          : "No screen on air";

  const focusRemotePeer = (peerId: string) => {
    setStoppedWatchingRemote(false);
    setFocusedPeerId(peerId);
    setStageSource("remote");
    setFullscreenTarget(null);
    setParticipantsVisible(false);
  };

  const focusLocalScreen = () => {
    setStageSource("local");
    setFullscreenTarget(null);
  };

  const minimizeStage = () => {
    setStageSource("none");
    setFullscreenTarget(null);
  };

  const stopWatchingRemote = () => {
    setStoppedWatchingRemote(true);
    setFocusedPeerId(null);
    setFullscreenTarget((current) => current?.type === "remote" ? null : current);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Brand compact />
          <View style={styles.headerActions}>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, isInviting && styles.disabled]}
              disabled={isInviting}
              onPress={() => void handleInvite()}
              accessibilityRole="button"
              accessibilityLabel="Share invite"
            >
              <ShareIcon color={colors.paper} />
              {!compactHeader ? <Text style={styles.iconButtonText}>{isInviting ? "Creating..." : "Invite"}</Text> : null}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]}
              onPress={onLeave}
              accessibilityRole="button"
              accessibilityLabel="Return to my rooms"
            >
              <Text style={styles.leaveText}>{compactHeader ? "Leave" : "My rooms"}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.headerMeta}>
          <View style={styles.roomIdentity}>
            <Text style={styles.roomLabel}>Room</Text>
            <Text style={styles.roomId} numberOfLines={1}>{roomId}</Text>
          </View>
          <View style={styles.metaRight}>
            <View style={styles.socketState} accessible accessibilityLabel={`Connection ${status}`}>
              <View style={[
                styles.statusDot,
                status === "connected" && styles.statusConnected,
                status === "reconnecting" && styles.statusReconnecting,
                status === "disconnected" && styles.statusDisconnected,
              ]} />
              {!compactHeader ? <Text style={styles.statusText}>{status}</Text> : null}
            </View>
            <View style={styles.peopleCompact}>
              <UsersIcon size={16} color={colors.muted} />
              <Text style={styles.peopleCompactText}>{peers.length + 1}</Text>
            </View>
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.errorClose, pressed && styles.pressed]}
            onPress={() => setError("")}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
          >
            <CloseIcon size={17} color={colors.redText} />
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.content, styles.stage]}>
        <View style={styles.stageHeading}>
          <View style={styles.stageHeadingCopy}>
            <View style={styles.eyebrow}>
              <View style={styles.acidDot} />
              <Text style={styles.eyebrowText}>{mainSource === "remote" ? "On stage" : mainSource === "local" ? "Your stage" : "Live room"}</Text>
            </View>
            <Text style={styles.stageTitle} numberOfLines={1}>{stageTitle}</Text>
          </View>
          <View style={styles.participantsControl}>
            <Pressable
              style={({ pressed }) => [styles.peopleCount, pressed && styles.pressed]}
              onPress={() => setParticipantsVisible((visible) => !visible)}
              accessibilityRole="button"
              accessibilityState={{ expanded: participantsVisible }}
              accessibilityLabel={`${peers.length + 1} people in room. ${participantsVisible ? "Close" : "Show"} participants`}
            >
              <UsersIcon color={colors.muted} />
              {!compactHeader ? (
                <Text style={styles.peopleText}><Text style={styles.peopleStrong}>{peers.length + 1}</Text> people</Text>
              ) : <Text style={styles.peopleStrong}>{peers.length + 1}</Text>}
            </Pressable>
            <ParticipantsList
              name={name}
              participants={peers}
              voiceState={{ voiceJoined: voiceState.joined, micMuted: voiceState.micMuted }}
              visible={participantsVisible}
              onClose={() => setParticipantsVisible(false)}
              focusedPeerId={focusedPeerId}
              onWatchPeer={focusRemotePeer}
            />
          </View>
        </View>

        {status !== "connected" ? (
          <View
            style={[styles.connectionNotice, status === "disconnected" && styles.connectionNoticeDisconnected]}
            accessibilityLiveRegion="polite"
          >
            <Text style={[styles.connectionNoticeText, status === "disconnected" && styles.connectionNoticeError]}>
              {status === "disconnected"
                ? "Connection lost · leave and rejoin the room"
                : "Reconnecting to the room…"}
            </Text>
            {status === "disconnected" ? (
              <Pressable
                style={({ pressed }) => [styles.emptyLeaveButton, pressed && styles.pressed]}
                onPress={onLeaveDisconnected}
                accessibilityRole="button"
              >
                <Text style={styles.leaveText}>My rooms</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.callStage}>
          {mainSource === null ? (
            <ParticipantsGrid
              localName={name}
              localStream={localStream}
              localMicMuted={voiceState.micMuted}
              peers={peers}
              focusedPeerId={focusedPeerId}
              focusedStream={focusedStream}
              onFocusPeer={focusRemotePeer}
              onFocusLocal={focusLocalScreen}
              onOpenParticipants={() => setParticipantsVisible(true)}
            />
          ) : null}

          {mainSource === "remote" && focusedPeer ? (
            focusedStream ? (
              <VideoTile
                stream={focusedStream}
                name={focusedPeer.name}
                state={focusedStreamId ? connectionStates[focusedStreamId] ?? null : null}
                stats={focusedStreamId ? remoteStats[focusedStreamId] ?? null : null}
                statsEnabled={statsEnabled}
                variant="stage"
                volume={volume}
                muted={!audioPreferencesReady || muted}
                onVolumeChange={changeVolume}
                onToggleMute={toggleMute}
                onToggleStats={toggleStats}
                onFullscreen={() => setFullscreenTarget({ type: "remote", peerId: focusedPeer.id })}
                onMinimize={minimizeStage}
                onStopWatching={stopWatchingRemote}
              />
            ) : (
              <View style={styles.connectingStage}>
                <View style={styles.screenOutline}>
                  <ScreenIcon size={34} color="#77776f" />
                  <View style={styles.scanLine} />
                </View>
                <Text style={styles.emptyTitle}>Connecting to {focusedPeer.name}'s screen…</Text>
                <Text style={styles.emptyBody}>Only this screen is being received. You can switch or stop watching at any time.</Text>
                <View style={styles.waitingActions}>
                  <Pressable
                    style={({ pressed }) => [styles.stageAction, pressed && styles.pressed]}
                    onPress={minimizeStage}
                    accessibilityRole="button"
                    accessibilityLabel="Minimize screen to the participant grid"
                  >
                    <Text style={styles.stageActionText}>Participant grid</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.stopWatchingAction, pressed && styles.pressed]}
                    onPress={stopWatchingRemote}
                    accessibilityRole="button"
                    accessibilityLabel={`Stop watching ${focusedPeer.name}'s screen`}
                  >
                    <CloseIcon size={16} color={colors.redText} />
                    <Text style={styles.stopWatchingText}>Stop watching</Text>
                  </Pressable>
                </View>
              </View>
            )
          ) : null}

          {mainSource === "local" && localStream ? (
            <View style={styles.localStage}>
              <VideoTile
                stream={localStream}
                name={name}
                local
                qualityLabel={localQuality}
                outboundStats={localOutboundStats}
                statsEnabled={statsEnabled}
                variant="stage"
                onToggleStats={toggleStats}
                onFullscreen={() => setFullscreenTarget({ type: "local" })}
              />
              <Pressable
                style={({ pressed }) => [styles.localMinimize, pressed && styles.pressed]}
                onPress={minimizeStage}
                accessibilityRole="button"
                accessibilityLabel="Minimize your screen to the participant grid"
              >
                <UsersIcon size={17} color={colors.paper} />
              </Pressable>
            </View>
          ) : null}

          {previewSource === "local" && localStream ? (
            <View style={[styles.preview, { width: Math.min(width * 0.34, 200) }]}>
              <VideoTile
                stream={localStream}
                name={name}
                local
                statsEnabled={statsEnabled}
                variant="preview"
                onSelect={focusLocalScreen}
                onFullscreen={() => setFullscreenTarget({ type: "local" })}
              />
            </View>
          ) : null}

          {previewSource === "remote" && focusedPeer ? (
            <View style={[styles.preview, { width: Math.min(width * 0.34, 200) }]}>
              {focusedStream ? (
                <VideoTile
                  stream={focusedStream}
                  name={focusedPeer.name}
                  state={focusedStreamId ? connectionStates[focusedStreamId] ?? null : null}
                  stats={focusedStreamId ? remoteStats[focusedStreamId] ?? null : null}
                  statsEnabled={statsEnabled}
                  variant="preview"
                  onSelect={() => focusRemotePeer(focusedPeer.id)}
                  onFullscreen={() => setFullscreenTarget({ type: "remote", peerId: focusedPeer.id })}
                  onStopWatching={stopWatchingRemote}
                />
              ) : (
                <View style={styles.previewWaiting} accessibilityLiveRegion="polite">
                  <ScreenIcon size={16} color={colors.muted} />
                  <Text style={styles.previewWaitingText} numberOfLines={2}>Connecting to {focusedPeer.name}'s screen…</Text>
                  <Pressable
                    style={({ pressed }) => [styles.previewStop, pressed && styles.pressed]}
                    onPress={stopWatchingRemote}
                    accessibilityRole="button"
                    accessibilityLabel={`Stop watching ${focusedPeer.name}'s screen`}
                  >
                    <CloseIcon size={15} color={colors.redText} />
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}
        </View>
      </View>

      <VoiceAudio
        tracks={remoteVoiceTracks}
        deafened={deafened}
        activeMediaCount={Object.keys(remoteVoiceTracks).length + Object.keys(remoteStreams).length}
      />

      <ControlDock
        name={name}
        status={status}
        localStream={localStream}
        isStartingShare={isStartingShare}
        activeSettings={shareSettings}
        voiceState={voiceState}
        deafened={deafened}
        onOpenSettings={() => setShareVisible(true)}
        onStopShare={stopSharing}
        onSetMicrophoneMuted={setMicrophoneMuted}
        onToggleDeafen={toggleDeafen}
      />

      <ShareSheet
        visible={shareVisible}
        isStarting={isStartingShare}
        onStart={handleStart}
        onCancel={() => setShareVisible(false)}
      />

      <FullscreenView
        visible={fullscreenTarget !== null}
        local={fullscreenTarget?.type === "local"}
        stream={fullscreenStream}
        connectionState={fullscreenTarget?.type === "remote" && fullscreenStreamId
          ? connectionStates[fullscreenStreamId] ?? null
          : null}
        name={fullscreenTarget?.type === "local" ? name : fullscreenPeer?.name ?? ""}
        stats={fullscreenTarget?.type === "remote" && fullscreenStreamId
          ? remoteStats[fullscreenStreamId] ?? null
          : null}
        statsEnabled={statsEnabled}
        volume={volume}
        muted={!audioPreferencesReady || muted}
        onVolumeChange={changeVolume}
        onToggleMute={toggleMute}
        onToggleStats={toggleStats}
        onClose={() => setFullscreenTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.room },
  header: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 16 },
  headerTop: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { minHeight: 40, minWidth: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: "#373732", borderRadius: radii.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  iconButtonText: { color: "#b5b5ad", fontSize: 11, fontWeight: "600" },
  leaveButton: { minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  leaveText: { color: colors.redText, fontSize: 11, fontWeight: "600" },
  headerMeta: { minHeight: 30, borderTopWidth: 1, borderTopColor: "#23231f", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  roomIdentity: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  roomLabel: { ...technicalText, color: colors.dim, fontSize: 7 },
  roomId: { color: "#bbb9af", fontFamily: "monospace", fontSize: 10, flexShrink: 1 },
  metaRight: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: 8 },
  socketState: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#77776f" },
  statusConnected: { backgroundColor: colors.acid, shadowColor: colors.acid, shadowOpacity: 0.5, shadowRadius: 5 },
  statusReconnecting: { backgroundColor: "#ffb13b" },
  statusDisconnected: { backgroundColor: colors.red },
  statusText: { ...technicalText, color: "#77776f", fontSize: 7 },
  peopleCompact: { flexDirection: "row", alignItems: "center", gap: 4 },
  peopleCompactText: { color: colors.paper, fontSize: 9, fontWeight: "700" },
  errorBanner: { marginHorizontal: 16, marginTop: 12, paddingLeft: 13, minHeight: 44, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", backgroundColor: "rgba(255,93,74,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  errorText: { color: colors.redText, fontSize: 12, flex: 1 },
  errorClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minHeight: 0, paddingBottom: 92 },
  stage: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 10 },
  stageHeading: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  stageHeadingCopy: { flex: 1 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 3 },
  acidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.acid },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 8 },
  stageTitle: { color: colors.paper, fontSize: 18, lineHeight: 22, fontWeight: "800", letterSpacing: -0.5 },
  participantsControl: { position: "relative", zIndex: 5 },
  peopleCount: { minHeight: 40, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#32322d", borderRadius: radii.control },
  peopleText: { color: "#85857d", fontSize: 10 },
  peopleStrong: { color: colors.paper, fontSize: 11, fontWeight: "800" },
  connectionNotice: { minHeight: 38, paddingHorizontal: 14, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#3b3b36", backgroundColor: "#1a1a17", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  connectionNoticeDisconnected: { borderBottomColor: "rgba(255,93,74,0.35)" },
  connectionNoticeText: { flex: 1, color: "#e5bf6b", fontSize: 10 },
  connectionNoticeError: { color: colors.redText },
  callStage: { flex: 1, minHeight: 220, position: "relative", overflow: "hidden", borderWidth: 1, borderColor: "#32322d", backgroundColor: colors.surface, padding: 7 },
  localStage: { flex: 1, minHeight: 0, position: "relative" },
  localMinimize: { position: "absolute", zIndex: 5, top: 12, right: 12, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#3d3d36", borderRadius: radii.control, backgroundColor: "rgba(16,16,14,0.9)" },
  connectingStage: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  screenOutline: { width: 92, height: 64, borderWidth: 1, borderColor: "#4a4a44", alignItems: "center", justifyContent: "center", marginBottom: 20, overflow: "hidden" },
  scanLine: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: colors.acid, opacity: 0.45 },
  emptyTitle: { color: colors.paper, fontSize: 16, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  emptyBody: { color: "#7e7e76", fontSize: 11, lineHeight: 17, textAlign: "center", maxWidth: 340 },
  waitingActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 16 },
  stageAction: { minHeight: 44, paddingHorizontal: 13, borderWidth: 1, borderColor: "#41413b", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  stageActionText: { color: colors.paper, fontSize: 10, fontWeight: "600" },
  stopWatchingAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", borderRadius: radii.control },
  stopWatchingText: { color: colors.redText, fontSize: 10, fontWeight: "600" },
  preview: { position: "absolute", zIndex: 4, right: 12, bottom: 76, aspectRatio: 16 / 10, maxHeight: "42%", overflow: "hidden", borderWidth: 1, borderColor: "#56564e", borderRadius: radii.control, backgroundColor: colors.black },
  previewWaiting: { flex: 1, minHeight: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, padding: 9, backgroundColor: "#11110f" },
  previewWaitingText: { flex: 1, color: colors.paper, fontSize: 9, textAlign: "center" },
  previewStop: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", borderRadius: radii.control },
  emptyLeaveButton: { minHeight: 40, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
