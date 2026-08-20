import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import SliderBase, { type SliderProps } from "@react-native-community/slider";

const Slider = SliderBase as unknown as React.ComponentType<SliderProps>;

type VolumeControlProps = {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
};

export function VolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: VolumeControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      {open ? (
        <View style={styles.popover}>
          <View style={styles.popoverRow}>
            <Pressable style={styles.muteButton} onPress={onToggleMute}>
              <Text style={styles.muteText}>{muted ? "Unmute" : "Mute"}</Text>
            </Pressable>
            <Text style={styles.levelText}>{muted ? "0%" : `${Math.round(volume * 100)}%`}</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={muted ? 0 : volume}
            onValueChange={onVolumeChange}
            minimumTrackTintColor="#ffb13b"
            maximumTrackTintColor="#3d3d36"
            thumbTintColor="#ffb13b"
          />
        </View>
      ) : null}
      <Pressable
        style={[styles.button, muted && styles.buttonMuted]}
        onPress={() => {
          if (open) {
            setOpen(false);
          } else {
            setOpen(true);
          }
        }}
      >
        <Text style={[styles.buttonText, muted && styles.buttonTextMuted]}>
          {muted ? "Muted" : "Vol"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "flex-end",
  },
  button: {
    backgroundColor: "rgba(16,16,14,0.88)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttonMuted: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
  },
  buttonTextMuted: {
    color: "#ff7766",
  },
  popover: {
    position: "absolute",
    right: 0,
    bottom: "100%",
    marginBottom: 8,
    width: 220,
    backgroundColor: "rgba(16,16,14,0.94)",
    borderWidth: 1,
    borderColor: "#3d3d36",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  popoverRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  muteButton: {
    paddingVertical: 2,
  },
  muteText: {
    color: "#ffb13b",
    fontSize: 13,
    fontWeight: "600",
  },
  levelText: {
    color: "#9c9c93",
    fontSize: 12,
  },
  slider: {
    width: "100%",
    height: 32,
  },
});