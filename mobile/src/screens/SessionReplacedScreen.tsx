import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "../components/Brand";
import { colors, radii, raisedSurface, technicalText } from "../theme";

type SessionReplacedScreenProps = {
  roomId: string;
  onReconnect: () => void;
  onLeave: () => void;
};

export function SessionReplacedScreen({ roomId, onReconnect, onLeave }: SessionReplacedScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}><Brand compact /></View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.eyebrow}>
            <View style={styles.acidDot} />
            <Text style={styles.eyebrowText} numberOfLines={1}>Room {roomId}</Text>
          </View>
          <Text style={styles.title}>Connected on another device</Text>
          <Text style={styles.note}>
            This session is open somewhere else. Move it here to take over that connection.
          </Text>
          <Pressable style={styles.primaryButton} onPress={onReconnect} accessibilityRole="button">
            <Text style={styles.primaryText}>Connect here instead</Text>
            <Text style={styles.arrow}>→</Text>
          </Pressable>
          <Pressable style={styles.leaveButton} onPress={onLeave} accessibilityRole="button">
            <Text style={styles.leaveText}>Leave room</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  header: { minHeight: 68, marginHorizontal: 22, borderBottomWidth: 1, borderBottomColor: colors.line, justifyContent: "center" },
  content: { flexGrow: 1, justifyContent: "center", padding: 22 },
  card: { width: "100%", maxWidth: 460, alignSelf: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: "#161614", padding: 28, ...raisedSurface },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 20 },
  acidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.acid },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 10, flexShrink: 1 },
  title: { color: colors.paper, fontSize: 30, lineHeight: 34, fontWeight: "800", letterSpacing: -1.3 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 18, marginBottom: 25 },
  primaryButton: { minHeight: 49, borderRadius: radii.control, backgroundColor: colors.acid, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 11 },
  primaryText: { color: colors.acidInk, fontSize: 15, fontWeight: "800" },
  arrow: { color: colors.acidInk, fontSize: 18 },
  leaveButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 9 },
  leaveText: { color: colors.muted, fontSize: 13 },
});
