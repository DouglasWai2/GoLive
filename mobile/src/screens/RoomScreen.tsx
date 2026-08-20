import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { buildInviteUrl, createInvite } from "@golive/core";
import type { ShareSettings } from "@golive/core";
import { useRoom } from "../hooks/useRoom";
import { VideoTile } from "../components/VideoTile";
import { ShareSheet } from "../components/ShareSheet";
import { ControlDock } from "../components/ControlDock";
import { INVITE_BASE_URL, SIGNALING_URL } from "../config";

type RoomScreenProps = {
  roomId: string;
  name: string;
  token: string;
  onLeave: () => void;
  onSessionRejected: () => void;
  onSessionReplaced: () => void;
};

export function RoomScreen({
  roomId,
  name,
  token,
  onLeave,
  onSessionRejected,
  onSessionReplaced,
}: RoomScreenProps) {
  const [shareVisible, setShareVisible] = useState(false);
  const [isInviting, setIsInviting] = useState(false);

  const {
    status,
    peers,
    localStream,
    isStartingShare,
    remoteStreams,
    connectionStates,
    error,
    setError,
    startSharing,
    stopSharing,
  } = useRoom(roomId, name, token, onSessionRejected, onSessionReplaced);

  const viewerEntries = Object.entries(remoteStreams);

  const handleStart = (settings: ShareSettings) => {
    setShareVisible(false);
    startSharing(settings);
  };

  const handleStop = () => {
    stopSharing();
  };

  const handleInvite = async () => {
    setIsInviting(true);
    setError("");

    try {
      const inviteToken = await createInvite(SIGNALING_URL, roomId, token);
      const link = buildInviteUrl(INVITE_BASE_URL, roomId, inviteToken);
      await Share.share({ message: link });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create an invite link.");
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.roomInfo}>
          <Text style={styles.roomLabel}>Room</Text>
          <Text style={styles.roomId}>{roomId}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.statusDot, status === "connected" && styles.statusDotOn]} />
          <Text style={styles.statusText}>
            {status === "connected" ? "connected" : status === "connecting" ? "connecting" : status}
          </Text>
          <Pressable
            style={[styles.inviteButton, isInviting && styles.inviteButtonDisabled]}
            disabled={isInviting}
            onPress={handleInvite}
          >
            <Text style={styles.inviteText}>{isInviting ? "..." : "Invite"}</Text>
          </Pressable>
          <Pressable style={styles.leaveButton} onPress={onLeave}>
            <Text style={styles.leaveText}>Leave</Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => setError("")}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView style={styles.content} contentContainerStyle={styles.stage}>
        {viewerEntries.length === 0 && !localStream ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {status === "connected"
                ? "No one is sharing yet"
                : "Connecting to the room..."}
            </Text>
            <Text style={styles.emptyBody}>
              Share your screen, or wait for someone else to start sharing.
            </Text>
          </View>
        ) : null}

        {viewerEntries.map(([peerId, stream]) => (
          <VideoTile
            key={peerId}
            stream={stream}
            name={
              peers.find((peer) => peer.id === peerId)?.name ?? peerId.slice(0, 4)
            }
            state={connectionStates[peerId] ?? null}
          />
        ))}

        {localStream ? (
          <VideoTile stream={localStream} name={name} small={viewerEntries.length > 0} />
        ) : null}
      </ScrollView>

      <ControlDock
        name={name}
        status={status}
        localStream={localStream}
        isStartingShare={isStartingShare}
        peers={peers}
        onOpenSettings={() => setShareVisible(true)}
        onStopShare={handleStop}
      />

      <ShareSheet
        visible={shareVisible}
        isStarting={isStartingShare}
        onStart={handleStart}
        onCancel={() => setShareVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#10100e",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 58,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#23231f",
  },
  roomInfo: {
    gap: 2,
  },
  roomLabel: {
    color: "#6f6f68",
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  roomId: {
    color: "#f2f1ec",
    fontSize: 18,
    fontWeight: "700",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#6f6f68",
  },
  statusDotOn: {
    backgroundColor: "#43d17c",
  },
  statusText: {
    color: "#9c9c93",
    fontSize: 13,
    textTransform: "capitalize",
  },
  leaveButton: {
    borderWidth: 1,
    borderColor: "#2c2c26",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  leaveText: {
    color: "#d5d4cd",
    fontSize: 13,
  },
  inviteButton: {
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inviteButtonDisabled: {
    opacity: 0.5,
  },
  inviteText: {
    color: "#ffb13b",
    fontSize: 13,
    fontWeight: "600",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,85,68,0.14)",
    borderBottomWidth: 1,
    borderBottomColor: "#3d1f1b",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: "#ff7766",
    fontSize: 13,
    flexShrink: 1,
  },
  errorDismiss: {
    color: "#ffb13b",
    fontSize: 13,
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
  stage: {
    padding: 16,
    gap: 12,
  },
  empty: {
    flex: 1,
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyTitle: {
    color: "#f2f1ec",
    fontSize: 17,
    fontWeight: "600",
  },
  emptyBody: {
    color: "#9c9c93",
    fontSize: 14,
    textAlign: "center",
  },
});