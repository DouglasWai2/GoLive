import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildInviteUrl, createInvite, formatBitrate, formatResolution } from "@golive/core";
import type { ShareSettings } from "@golive/core";
import { useRoom } from "../hooks/useRoom";
import { Brand } from "../components/Brand";
import { CloseIcon, MicrophoneIcon, MicrophoneMutedIcon, ScreenIcon, ShareIcon, UsersIcon, VolumeIcon, VolumeMutedIcon } from "../components/icons";
import { VideoTile } from "../components/VideoTile";
import { ShareSheet } from "../components/ShareSheet";
import { ControlDock } from "../components/ControlDock";
import { FullscreenView } from "../components/FullscreenView";
import { VoiceAudio } from "../components/VoiceAudio";
import { INVITE_BASE_URL, SIGNALING_URL } from "../config";
import { colors, radii, technicalText } from "../theme";
import { ParticipantsList } from "../components/ParticipantsList";

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
  const [fullscreenPeerId, setFullscreenPeerId] = useState<string | null>(null);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const [deafened, setDeafened] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 720;
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
    focusPeer,
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
    if (focusedPeerId && activeSharers.some((peer) => peer.id === focusedPeerId)) return;
    setFocusedPeerId(activeSharers[0]?.id ?? null);
  }, [focusedPeerId, peers]);

  useEffect(() => {
    focusPeer(focusedPeerId);
  }, [focusPeer, focusedPeerId]);

  useEffect(() => {
    const fullscreenPeer = peers.find((peer) => peer.id === fullscreenPeerId);
    if (fullscreenPeerId && (!fullscreenPeer?.streamId || !remoteStreams[fullscreenPeer.streamId])) {
      setFullscreenPeerId(null);
    }
  }, [fullscreenPeerId, peers, remoteStreams]);

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
  const focusedPeer = activeSharers.find((peer) => peer.id === focusedPeerId)
    ?? activeSharers.find((peer) => Boolean(peer.streamId && remoteStreams[peer.streamId]))
    ?? activeSharers[0];
  const focusedStreamId = focusedPeer?.streamId ?? null;
  const focusedStream = focusedStreamId ? remoteStreams[focusedStreamId] ?? null : null;
  const fullscreenPeer = peers.find((peer) => peer.id === fullscreenPeerId);
  const fullscreenStreamId = fullscreenPeer?.streamId ?? null;
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

  const stageTitle = localStream
    ? "You are presenting"
    : focusedPeer
      ? `Focused on ${focusedPeer.name}`
      : "Ready when you are";

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
            <Pressable style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]} onPress={onLeave} accessibilityRole="button">
              <Text style={styles.leaveText}>My rooms</Text>
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
          <Pressable style={styles.errorClose} onPress={() => setError("")} accessibilityLabel="Dismiss error">
            <CloseIcon size={17} color={colors.redText} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.stage}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stageHeading}>
          <View style={styles.stageHeadingCopy}>
            <View style={styles.eyebrow}>
              <View style={styles.acidDot} />
              <Text style={styles.eyebrowText}>Live room</Text>
            </View>
            <Text style={styles.stageTitle}>{stageTitle}</Text>
          </View>
          <View>
            <Pressable
              style={({ pressed }) => [styles.peopleCount, pressed && styles.pressed]}
              onPress={() => setParticipantsVisible((visible) => !visible)}
            >
              <UsersIcon color={colors.muted} />
              <Text style={styles.peopleText}><Text style={styles.peopleStrong}>{peers.length + 1}</Text> in room</Text>
            </Pressable>
            {participantsVisible && <ParticipantsList name={name} participants={peers} voiceState={{ voiceJoined: voiceState.joined, micMuted: voiceState.micMuted }} />}
          </View>
        </View>

        {activeSharers.length > 0 ? (
          <ScrollView
            horizontal
            style={styles.streamSelector}
            contentContainerStyle={styles.streamSelectorContent}
            showsHorizontalScrollIndicator={false}
            accessibilityLabel="Live screens"
          >
            {activeSharers.map((peer) => (
              <Pressable
                key={peer.id}
                style={({ pressed }) => [
                  styles.streamChoice,
                  peer.id === focusedPeer?.id && styles.streamChoiceSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => setFocusedPeerId(peer.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: peer.id === focusedPeer?.id }}
                accessibilityLabel={`${peer.name}'s screen${peer.id === focusedPeer?.id ? ", focused" : ", select to watch"}`}
              >
                <View style={styles.streamLiveDot} />
                <View style={styles.streamChoiceCopy}>
                  <Text style={styles.streamChoiceName} numberOfLines={1}>{peer.name}</Text>
                  <Text style={styles.streamChoiceStatus}>
                    {peer.id === focusedPeer?.id ? "Focused" : "Select to watch"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={[styles.videoGrid, (localStream || focusedStream) && styles.videoGridActive]}>
          {!focusedStream && !localStream ? (
            <View style={styles.empty}>
              <View style={styles.screenOutline}>
                <ScreenIcon size={38} color="#77776f" />
                <View style={styles.scanLine} />
              </View>
              <Text style={styles.emptyTitle}>
                {status === "reconnecting"
                  ? "Reconnecting to the room..."
                  : status === "disconnected"
                    ? "Connection lost"
                    : focusedPeer
                      ? `Connecting to ${focusedPeer.name}'s screen...`
                      : activeSharers.length > 0
                        ? "Choose a screen to focus"
                      : status === "connected"
                        ? "No screen on air"
                        : "Connecting to the room..."}
              </Text>
              <Text style={styles.emptyBody}>
                {status === "reconnecting"
                  ? "Your session will resume automatically when the connection returns."
                  : status === "disconnected"
                    ? "Leave and rejoin the room to start a new session."
                    : focusedPeer
                      ? "Checking available peer and relay paths."
                      : activeSharers.length > 0
                        ? "Select one live screen to receive its video and audio."
                      : "Invite someone, then choose a window or display to begin."}
              </Text>
              {status === "disconnected" ? (
                <Pressable style={({ pressed }) => [styles.emptyLeaveButton, pressed && styles.pressed]} onPress={onLeaveDisconnected} accessibilityRole="button">
                  <Text style={styles.leaveText}>My rooms</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.tileGrid, wide && styles.tileGridWide]}>
            {focusedPeer && focusedStream && (
              <View style={[styles.tileWrap, wide && styles.tileWrapWide]}>
                <VideoTile
                  stream={focusedStream}
                  name={focusedPeer.name}
                  state={focusedStreamId ? connectionStates[focusedStreamId] ?? null : null}
                  stats={focusedStreamId ? remoteStats[focusedStreamId] ?? null : null}
                  statsEnabled={statsEnabled}
                  volume={volume}
                  muted={!audioPreferencesReady || muted}
                  onVolumeChange={changeVolume}
                  onToggleMute={toggleMute}
                  onToggleStats={toggleStats}
                  onFullscreen={() => setFullscreenPeerId(focusedPeer.id)}
                />
              </View>
            )}

            {localStream ? (
              <View style={[styles.tileWrap, wide && styles.tileWrapWide]}>
                <VideoTile
                  stream={localStream}
                  name={name}
                  local
                  qualityLabel={localQuality}
                  outboundStats={localOutboundStats}
                  statsEnabled={statsEnabled}
                  onToggleStats={toggleStats}
                />
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

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
        visible={fullscreenPeerId !== null}
        stream={fullscreenStreamId ? remoteStreams[fullscreenStreamId] ?? null : null}
        connectionState={fullscreenStreamId ? connectionStates[fullscreenStreamId] ?? null : null}
        name={fullscreenPeer?.name ?? fullscreenPeerId?.slice(0, 4) ?? ""}
        stats={fullscreenStreamId ? remoteStats[fullscreenStreamId] ?? null : null}
        statsEnabled={statsEnabled}
        volume={volume}
        muted={!audioPreferencesReady || muted}
        onVolumeChange={changeVolume}
        onToggleMute={toggleMute}
        onToggleStats={toggleStats}
        onClose={() => setFullscreenPeerId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.room },
  header: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 16 },
  headerTop: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { minHeight: 40, minWidth: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: "#373732", borderRadius: radii.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  iconButtonText: { color: "#b5b5ad", fontSize: 11, fontWeight: "600" },
  leaveButton: { minHeight: 40, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  leaveText: { color: colors.redText, fontSize: 11, fontWeight: "600" },
  headerMeta: { minHeight: 39, borderTopWidth: 1, borderTopColor: "#23231f", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  roomIdentity: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9, flexShrink: 1 },
  roomLabel: { ...technicalText, color: colors.dim, fontSize: 8 },
  roomId: { color: "#bbb9af", fontFamily: "monospace", fontSize: 10, flexShrink: 1 },
  metaRight: { flexDirection: "row", alignItems: "center", gap: 14, marginLeft: 12 },
  socketState: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#77776f" },
  statusConnected: { backgroundColor: colors.acid, shadowColor: colors.acid, shadowOpacity: 0.5, shadowRadius: 5 },
  statusReconnecting: { backgroundColor: "#ffb13b" },
  statusDisconnected: { backgroundColor: colors.red },
  statusText: { ...technicalText, color: "#77776f", fontSize: 8 },
  peopleCompact: { flexDirection: "row", alignItems: "center", gap: 5 },
  peopleCompactText: { color: colors.paper, fontSize: 10, fontWeight: "700" },
  errorBanner: { marginHorizontal: 16, marginTop: 12, paddingLeft: 13, minHeight: 44, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", backgroundColor: "rgba(255,93,74,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  errorText: { color: colors.redText, fontSize: 12, flex: 1 },
  errorClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { flex: 1 },
  stage: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 102 },
  stageHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 19 },
  stageHeadingCopy: { flex: 1 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  acidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.acid },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 9 },
  stageTitle: { color: colors.paper, fontSize: 27, lineHeight: 31, fontWeight: "800", letterSpacing: -1.25 },
  peopleCount: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderStyle: "solid", borderColor: "#32322d", padding: 5 },
  peopleText: { color: "#85857d", fontSize: 10 },
  peopleStrong: { color: colors.paper, fontWeight: "800" },
  streamSelector: { flexGrow: 0, marginBottom: 9 },
  streamSelectorContent: { gap: 8, paddingRight: 2 },
  streamChoice: { width: 174, minHeight: 54, paddingHorizontal: 10, borderWidth: 1, borderColor: "#373732", backgroundColor: "#171715", flexDirection: "row", alignItems: "center", gap: 9 },
  streamChoiceSelected: { borderColor: "rgba(201,255,66,0.7)", backgroundColor: "rgba(201,255,66,0.08)" },
  streamLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  streamChoiceCopy: { flex: 1, minWidth: 0 },
  streamChoiceName: { color: colors.paper, fontSize: 11, fontWeight: "700" },
  streamChoiceStatus: { ...technicalText, color: colors.muted, fontSize: 8, marginTop: 3 },
  videoGrid: { borderWidth: 1, borderColor: "#32322d", backgroundColor: colors.surface, padding: 7, alignItems: "stretch", justifyContent: "center" },
  videoGridActive: { justifyContent: "flex-start" },
  tileGrid: { gap: 8 },
  tileGridWide: { flexDirection: "row", flexWrap: "wrap" },
  tileWrap: { width: "100%", minHeight: 220 },
  tileWrapWide: { width: "49%" },
  empty: { minHeight: 312, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  screenOutline: { width: 104, height: 74, borderWidth: 1, borderColor: "#4a4a44", alignItems: "center", justifyContent: "center", marginBottom: 28, overflow: "hidden" },
  scanLine: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: colors.acid, opacity: 0.45 },
  emptyTitle: { color: colors.paper, fontSize: 19, fontWeight: "700", marginBottom: 9, textAlign: "center" },
  emptyBody: { color: "#7e7e76", fontSize: 12, lineHeight: 19, textAlign: "center", maxWidth: 340 },
  emptyLeaveButton: { minHeight: 44, marginTop: 22, paddingHorizontal: 18, borderWidth: 1, borderColor: "rgba(255,93,74,0.35)", borderRadius: radii.control, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
