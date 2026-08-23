import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { parseInviteUrl } from "@golive/core";
import { Brand } from "../components/Brand";
import { ScreenIcon } from "../components/icons";
import { createRoomId } from "../utils/roomId";
import { colors, radii, raisedSurface, spacing, technicalText } from "../theme";

type LandingScreenProps = {
  onJoinRoom: (roomId: string, inviteToken?: string) => void;
};

export function LandingScreen({ onJoinRoom }: LandingScreenProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const { width, height } = useWindowDimensions();
  const showMock = width >= 360 && height >= 690;

  const join = () => {
    const invite = parseInviteUrl(input.trim());

    if (!invite) {
      setError("Paste a full invite link to join a room.");
      return;
    }

    setError("");
    onJoinRoom(invite.roomId, invite.inviteToken);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.nav}>
            <Brand />
            <Text style={styles.navNote}>Nothing recorded</Text>
          </View>

          <View style={styles.hero}>
            <View style={styles.eyebrow}>
              <View style={styles.acidDot} />
              <Text style={styles.eyebrowText}>Direct screen sharing</Text>
            </View>
            <Text style={styles.title}>Your screen.</Text>
            <Text style={styles.titleMuted}>Their browser.</Text>
            <Text style={styles.intro}>
              Start a room and share your screen with a link. No accounts or video
              servers in the middle.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              onPress={() => onJoinRoom(createRoomId())}
              accessibilityRole="button"
              accessibilityLabel="Create a room"
            >
              <ScreenIcon size={21} color={colors.acidInk} />
              <Text style={styles.primaryText}>Create a room</Text>
            </Pressable>
          </View>

          {showMock ? (
            <View
              style={styles.heroPanel}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.panelBar}>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.panelTextLight}>Live</Text>
                </View>
                <Text style={styles.panelText}>golive / studio-08</Text>
              </View>
              <View style={styles.screenMock}>
                <View style={styles.mockWindow}>
                  <View style={styles.mockSidebar} />
                  <View style={styles.mockContent}>
                    <View style={[styles.mockBlock, styles.mockBlockWide]} />
                    <View style={styles.mockBlock} />
                    <View style={styles.mockBlock} />
                  </View>
                </View>
                <View style={styles.signalLines}>
                  <View style={[styles.signalLine, styles.signalOne]} />
                  <View style={[styles.signalLine, styles.signalTwo]} />
                  <View style={[styles.signalLine, styles.signalThree]} />
                </View>
              </View>
              <View style={styles.panelFooter}>
                <Text style={styles.panelText}>1080p</Text>
                <Text style={styles.panelText}>30 fps</Text>
                <Text style={[styles.panelText, styles.panelFooterLast]}>P2P encrypted</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.joinSection}>
            <View style={styles.joinHeading}>
              <Text style={styles.step}>02</Text>
              <View style={styles.joinCopy}>
                <Text style={styles.joinTitle}>Already invited?</Text>
                <Text style={styles.joinSubtitle}>Paste an invite link to join a room.</Text>
              </View>
            </View>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={(value) => {
                setInput(value);
                if (error) setError("");
              }}
              placeholder="Invite link"
              placeholderTextColor={colors.dim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={join}
              accessibilityLabel="Invite link"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.joinButton, pressed && styles.pressed]}
              onPress={join}
              accessibilityRole="button"
            >
              <Text style={styles.joinButtonText}>Join room</Text>
              <Text style={styles.joinArrow}>→</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  scroll: { paddingHorizontal: spacing.xxl, paddingBottom: 48 },
  nav: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  navNote: { ...technicalText, color: colors.muted, fontSize: 9 },
  hero: { paddingTop: 54, paddingBottom: 44 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 20 },
  acidDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.acid,
    shadowColor: colors.acid,
    shadowOpacity: 0.55,
    shadowRadius: 6,
  },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 10 },
  title: {
    color: colors.paper,
    fontSize: 51,
    lineHeight: 52,
    fontWeight: "800",
    letterSpacing: -3.4,
  },
  titleMuted: {
    color: colors.muted,
    fontSize: 47,
    lineHeight: 50,
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontStyle: "italic",
    letterSpacing: -2.4,
  },
  intro: { color: "#b4b4aa", fontSize: 16, lineHeight: 25, marginTop: 27, marginBottom: 28 },
  primaryButton: {
    minHeight: 56,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
    borderRadius: radii.control,
    backgroundColor: colors.acid,
  },
  primaryText: { color: colors.acidInk, fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  heroPanel: {
    borderWidth: 1,
    borderColor: "#393934",
    backgroundColor: colors.surface,
    marginBottom: 52,
    transform: [{ rotate: "1deg" }],
    ...raisedSurface,
  },
  panelBar: {
    minHeight: 45,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#343430",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  panelText: { ...technicalText, color: "#73736c", fontSize: 8 },
  panelTextLight: { ...technicalText, color: colors.paper, fontSize: 8 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  screenMock: {
    aspectRatio: 1.65,
    margin: 14,
    borderWidth: 1,
    borderColor: "#40403a",
    backgroundColor: "#22221f",
    alignItems: "center",
    justifyContent: "center",
  },
  mockWindow: {
    width: "70%",
    height: "61%",
    backgroundColor: "#cecdc3",
    flexDirection: "row",
    padding: 11,
    gap: 12,
  },
  mockSidebar: { width: "22%", backgroundColor: "#aeada4" },
  mockContent: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mockBlock: { flexGrow: 1, width: "40%", backgroundColor: "#edebe1" },
  mockBlockWide: { width: "100%", height: "46%" },
  signalLines: {
    position: "absolute",
    right: 22,
    bottom: 17,
    height: 30,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  signalLine: { width: 4, backgroundColor: colors.acid },
  signalOne: { height: 10 },
  signalTwo: { height: 20 },
  signalThree: { height: 30 },
  panelFooter: {
    minHeight: 43,
    paddingHorizontal: 15,
    borderTopWidth: 1,
    borderTopColor: "#343430",
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  panelFooterLast: { marginLeft: "auto", color: colors.muted },
  joinSection: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.xxl,
  },
  joinHeading: { flexDirection: "row", alignItems: "center", gap: 17, marginBottom: 20 },
  step: { ...technicalText, color: "#55554f", fontSize: 10 },
  joinCopy: { gap: 4 },
  joinTitle: { color: colors.paper, fontSize: 14, fontWeight: "700" },
  joinSubtitle: { color: colors.muted, fontSize: 12 },
  input: {
    minHeight: 51,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 0,
    paddingHorizontal: 16,
    color: colors.paper,
    fontSize: 15,
    backgroundColor: "transparent",
  },
  error: { color: "#ff6b5e", fontSize: 12, marginTop: 9 },
  joinButton: {
    minHeight: 49,
    marginTop: 9,
    paddingHorizontal: 18,
    backgroundColor: colors.paper,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  joinButtonText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  joinArrow: { color: colors.dim, fontSize: 17, marginLeft: 14 },
});
