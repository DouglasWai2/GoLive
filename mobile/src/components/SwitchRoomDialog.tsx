import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, raisedSurface, technicalText } from "../theme";

type SwitchRoomDialogProps = {
  visible: boolean;
  onStay: () => void;
  onSwitch: () => void;
};

export function SwitchRoomDialog({ visible, onStay, onSwitch }: SwitchRoomDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onStay}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={styles.eyebrow}>
            <View style={styles.acidDot} />
            <Text style={styles.eyebrowText}>Room invitation</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">Switch rooms?</Text>
          <Text style={styles.description}>You will lose access to your current room.</Text>
          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={onSwitch} accessibilityRole="button">
            <Text style={styles.primaryText}>Switch rooms  →</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.stayButton, pressed && styles.pressed]} onPress={onStay} accessibilityRole="button">
            <Text style={styles.stayText}>Stay in current room</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 20 },
  dialog: { width: "100%", maxWidth: 460, alignSelf: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: "#161614", padding: 28, ...raisedSurface },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 20 },
  acidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.acid },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 10 },
  title: { color: colors.paper, fontSize: 30, fontWeight: "800", letterSpacing: -1.3 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 16, marginBottom: 26 },
  primaryButton: { minHeight: 49, borderRadius: radii.control, backgroundColor: colors.acid, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.acidInk, fontSize: 15, fontWeight: "800" },
  stayButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 9 },
  stayText: { color: colors.muted, fontSize: 13 },
  pressed: { opacity: 0.75 },
});
