import { StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { MediaStream as RNMediaStream } from "react-native-webrtc";
import type { MediaStream, PeerConnectionState } from "@golive/core";

type VideoTileProps = {
  stream: MediaStream;
  name: string;
  state?: PeerConnectionState | null;
  small?: boolean;
};

export function VideoTile({ stream, name, state, small = false }: VideoTileProps) {
  const rnStream = stream as unknown as RNMediaStream;

  return (
    <View style={[styles.tile, small && styles.tileSmall]}>
      <RTCView
        style={styles.video}
        streamURL={rnStream.toURL()}
        objectFit="cover"
        mirror={false}
      />
      <View style={styles.meta}>
        <View style={styles.liveDot} />
        <Text style={styles.name} numberOfLines={1}>
          {name}'s screen
        </Text>
        {state ? <Text style={styles.state}>{state}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 200,
    backgroundColor: "#16160f",
    borderRadius: 12,
    overflow: "hidden",
  },
  tileSmall: {
    minHeight: 96,
    borderRadius: 8,
  },
  video: {
    flex: 1,
    backgroundColor: "#000",
  },
  meta: {
    position: "absolute",
    left: 8,
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16,16,14,0.75)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff4433",
  },
  name: {
    color: "#f2f1ec",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  state: {
    color: "#9c9c93",
    fontSize: 12,
    textTransform: "capitalize",
  },
});