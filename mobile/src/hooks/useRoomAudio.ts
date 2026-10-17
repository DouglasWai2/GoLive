import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import {
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
} from "expo-audio";
import type { NotificationSound } from "@golive/core";

const shareStartSource = require("../../assets/notification-sounds/share-start.wav");
const shareStopSource = require("../../assets/notification-sounds/share-stop.wav");
const peerJoinSource = require("../../assets/notification-sounds/peer-join.wav");
const peerLeaveSource = require("../../assets/notification-sounds/peer-leave.wav");
const micMuteSource = require("../../assets/notification-sounds/mic-mute.wav");
const micUnmuteSource = require("../../assets/notification-sounds/mic-unmute.wav");
const deafenSource = require("../../assets/notification-sounds/deafen.wav");
const undeafenSource = require("../../assets/notification-sounds/undeafen.wav");

export function useRoomAudio() {
  const shareStartPlayer = useAudioPlayer(shareStartSource);
  const shareStopPlayer = useAudioPlayer(shareStopSource);
  const peerJoinPlayer = useAudioPlayer(peerJoinSource);
  const peerLeavePlayer = useAudioPlayer(peerLeaveSource);
  const micMutePlayer = useAudioPlayer(micMuteSource);
  const micUnmutePlayer = useAudioPlayer(micUnmuteSource);
  const deafenPlayer = useAudioPlayer(deafenSource);
  const undeafenPlayer = useAudioPlayer(undeafenSource);
  const audioGeneration = useRef(0);

  const startRoomAudio = useCallback(async (): Promise<boolean | null> => {
    const generation = audioGeneration.current + 1;
    audioGeneration.current = generation;
    let notificationPermissionGranted: boolean | null = null;

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        allowsRecording: true,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      });
    } catch {
      // WebRTC voice audio continues if audio-session setup is unavailable.
    }

    if (Platform.OS === "android") {
      try {
        const permission = await requestNotificationPermissionsAsync();
        notificationPermissionGranted = permission.granted;
      } catch {
        // The in-app notice remains hidden when the permission API is unavailable.
      }
    }

    if (audioGeneration.current !== generation) return notificationPermissionGranted;
    return notificationPermissionGranted;
  }, []);

  const stopRoomAudio = useCallback(() => {
    audioGeneration.current += 1;

    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
      allowsBackgroundRecording: false,
    }).catch(() => {});
  }, []);

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
