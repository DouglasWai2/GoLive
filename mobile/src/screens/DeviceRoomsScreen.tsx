import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { ListRenderItem } from "react-native";
import type { DeviceRoom } from "@golive/core";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "../components/Brand";
import { colors, radii, raisedSurface, spacing, technicalText } from "../theme";
import type { MobileAuthUser } from "../auth";

type DeviceRoomsScreenProps = {
  rooms: DeviceRoom[];
  onEnter: (roomId: string) => void;
  onCreateRoom: () => void;
  onOpenProfile: () => void;
  onRemoveRoom: (room: DeviceRoom) => void;
  authConfigured: boolean;
  authBusy: boolean;
  authUser: MobileAuthUser | null;
  authError: string;
  onSignIn: () => void;
  onSignOut: () => void;
};

export function DeviceRoomsScreen({
  rooms,
  onEnter,
  onCreateRoom,
  onOpenProfile,
  onRemoveRoom,
  authConfigured,
  authBusy,
  authUser,
  authError,
  onSignIn,
  onSignOut,
}: DeviceRoomsScreenProps) {
  const renderRoom: ListRenderItem<DeviceRoom> = ({ item }) => (
    <View style={styles.roomCard}>
      <View style={styles.roomCopy}>
        <Text style={styles.roomKind}>{item.owner ? "Your room" : "Invited room"}</Text>
        <Text style={styles.roomName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.roomId} numberOfLines={1}>{item.id}</Text>
      </View>
      <View style={styles.roomActions}>
        <Pressable
          style={({ pressed }) => [styles.enterButton, pressed && styles.pressed]}
          onPress={() => onEnter(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Enter ${item.name}`}
        >
          <Text style={styles.enterText}>Enter →</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
          onPress={() => Alert.alert("Remove room access?", `You will need a new invite to return to ${item.name}.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => onRemoveRoom(item) },
          ])}
          accessibilityRole="button"
          accessibilityLabel={`Remove access to ${item.name}`}
        >
          <Text style={styles.removeText}>Remove access</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Brand compact />
        <View style={styles.headerActions}>
          <Pressable onPress={onOpenProfile} accessibilityRole="button" style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}>
            <Text style={styles.profileText}>Profile</Text>
          </Pressable>
          <Pressable onPress={onCreateRoom} accessibilityRole="button" style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}>
            <Text style={styles.createText}>+ Room</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={rooms}
        keyExtractor={(room) => room.id}
        renderItem={renderRoom}
        contentContainerStyle={[styles.content, rooms.length === 0 && styles.emptyContent]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <View style={styles.titleBlock}>
            <View style={styles.eyebrow}><View style={styles.acidDot} /><Text style={styles.eyebrowText}>Your GoLive</Text></View>
            <Text style={styles.title}>My rooms</Text>
            <Text style={styles.subtitle}>Rooms you can return to from this device.</Text>
            {authConfigured ? (
              <View style={styles.authRow}>
                <Text style={styles.authText} numberOfLines={1}>
                  {authUser ? `Signed in as ${authUser.name || authUser.email}` : "Sign in with Google to create up to five active rooms."}
                </Text>
                <Pressable onPress={authUser ? onSignOut : onSignIn} disabled={authBusy} accessibilityRole="button">
                  <Text style={styles.authAction}>{authBusy ? "Please wait…" : authUser ? "Sign out" : "Sign in"}</Text>
                </Pressable>
              </View>
            ) : null}
            {authError ? <Text style={styles.authError} accessibilityRole="alert">{authError}</Text> : null}
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Your list is ready</Text>
            <Text style={styles.emptyBody}>Rooms you create or join with an invite will appear here.</Text>
            <Pressable onPress={onCreateRoom} accessibilityRole="button" style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}>
              <Text style={styles.enterText}>Create a room →</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  header: { minHeight: 68, marginHorizontal: 22, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  profileButton: { minHeight: 40, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  profileText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  createButton: { minHeight: 39, paddingHorizontal: 13, borderRadius: radii.control, backgroundColor: colors.acid, justifyContent: "center" },
  createText: { color: colors.acidInk, fontSize: 12, fontWeight: "800" },
  content: { paddingHorizontal: 22, paddingBottom: 44 },
  emptyContent: { flexGrow: 1 },
  titleBlock: { paddingTop: 42, paddingBottom: 25 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 15 },
  acidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.acid },
  eyebrowText: { ...technicalText, color: colors.muted, fontSize: 9 },
  title: { color: colors.paper, fontSize: 43, lineHeight: 47, fontWeight: "800", letterSpacing: -2.5 },
  subtitle: { marginTop: 10, color: colors.muted, fontSize: 13, lineHeight: 19 },
  authRow: { marginTop: 17, flexDirection: "row", alignItems: "center", gap: 12 },
  authText: { flex: 1, color: colors.dim, fontSize: 10 },
  authAction: { color: colors.acid, fontSize: 10, fontWeight: "700" },
  authError: { color: "#ff6b5e", fontSize: 11, marginTop: 10 },
  roomCard: { minHeight: 121, paddingVertical: 18, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  roomCopy: { minWidth: 0, flex: 1 },
  roomKind: { marginBottom: 7, color: colors.dim, ...technicalText, fontSize: 8 },
  roomName: { color: colors.paper, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  roomId: { marginTop: 7, color: colors.dim, fontFamily: "monospace", fontSize: 9 },
  roomActions: { alignItems: "flex-end", gap: 6 },
  enterButton: { minHeight: 39, minWidth: 87, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radii.control, backgroundColor: colors.acid },
  enterText: { color: colors.acidInk, fontSize: 12, fontWeight: "800" },
  removeButton: { minHeight: 34, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  removeText: { color: "#a2746f", fontSize: 10 },
  emptyState: { flex: 1, justifyContent: "center", padding: spacing.xl, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, ...raisedSurface },
  emptyTitle: { color: colors.paper, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  emptyBody: { marginTop: 10, marginBottom: 22, color: colors.muted, fontSize: 13, lineHeight: 20 },
  emptyButton: { minHeight: 45, paddingHorizontal: 15, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", backgroundColor: colors.acid, borderRadius: radii.control },
  pressed: { opacity: 0.75 },
});
