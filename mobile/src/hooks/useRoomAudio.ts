import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import {
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
} from "expo-audio";
import type { NotificationSound } from "@golive/core";

const roomActiveSource = require("../../assets/notification-sounds/room-active.wav");
const shareStartSource = require("../../assets/notification-sounds/share-start.wav");
const shareStopSource = require("../../assets/notification-sounds/share-stop.wav");
const peerJoinSource = require("../../assets/notification-sounds/peer-join.wav");
const peerLeaveSource = require("../../assets/notification-sounds/peer-leave.wav");
const micMuteSource = require("../../assets/notification-sounds/mic-mute.wav");
const micUnmuteSource = require("../../assets/notification-sounds/mic-unmute.wav");
const deafenSource = require("../../assets/notification-sounds/deafen.wav");
const undeafenSource = require("../../assets/notification-sounds/undeafen.wav");

export function useRoomAudio(roomId: string) {
  const roomActivePlayer = useAudioPlayer(roomActiveSource);
  const shareStartPlayer = useAudioPlayer(shareStartSource);
  const shareStopPlayer = useAudioPlayer(shareStopSource);
  const peerJoinPlayer = useAudioPlayer(peerJoinSource);
  const peerLeavePlayer = useAudioPlayer(peerLeaveSource);
  const micMutePlayer = useAudioPlayer(micMuteSource);
  const micUnmutePlayer = useAudioPlayer(micUnmuteSource);
  const deafenPlayer = useAudioPlayer(deafenSource);
  const undeafenPlayer = useAudioPlayer(undeafenSource);
  const audioGeneration = useRef(0);

  const startRoomAudio = useCallback(async () => {
    const generation = audioGeneration.current + 1;
    audioGeneration.current = generation;

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        allowsRecording: true,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      });

      if (Platform.OS === "android") {
        await requestNotificationPermissionsAsync();
      }

      if (audioGeneration.current !== generation) return;

      roomActivePlayer.loop = true;
      roomActivePlayer.volume = 0;

      if (Platform.OS === "android") {
        roomActivePlayer.setActiveForLockScreen(
          true,
          { title: "GoLive", artist: `Connected to room ${roomId}` },
          { isLiveStream: true, showSeekBackward: false, showSeekForward: false },
        );
      }

      roomActivePlayer.play();
    } catch {
      // Room audio is optional; WebRTC should continue if native playback is unavailable.
    }
  }, [roomActivePlayer, roomId]);

  const stopRoomAudio = useCallback(() => {
    audioGeneration.current += 1;

    try {
      roomActivePlayer.pause();
      if (Platform.OS === "android") {
        roomActivePlayer.setActiveForLockScreen(false);
      }
    } catch {
      // Players may already be released while the room component is unmounting.
    }
  }, [roomActivePlayer]);

  const playNotificationSound = useCallback((sound: NotificationSound) => {
    const player = {
      "share-start": shareStartPlayer,
      "share-stop": shareStopPlayer,
      "peer-join": peerJoinPlayer,
      "peer-leave": peerLeavePlayer,
      "mic-mute": micMutePlayer,
      "mic-unmute": micUnmutePlayer,
      deafen: deafenPlayer,
      undeafen: undeafenPlayer,
    }[sound];

    void player.seekTo(0).then(() => player.play()).catch(() => {
      // Notification sounds must never interrupt room behavior.
    });
  }, [
    deafenPlayer,
    micMutePlayer,
    micUnmutePlayer,
    peerJoinPlayer,
    peerLeavePlayer,
    shareStartPlayer,
    shareStopPlayer,
    undeafenPlayer,
  ]);

  return { startRoomAudio, stopRoomAudio, playNotificationSound };
}
