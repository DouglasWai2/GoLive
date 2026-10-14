import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla/adapters";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { Platform } from "react-native";
import { fetchNeonAuthToken } from "@golive/core";

const neonAuthUrl = process.env.EXPO_PUBLIC_NEON_AUTH_URL;
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleAuthEnabled = process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED === undefined
  ? __DEV__
  : process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

const authClient = googleAuthEnabled && neonAuthUrl
  ? createAuthClient(neonAuthUrl, {
      adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: "include" } }),
    })
  : null;

if (googleAuthEnabled && googleWebClientId) {
  GoogleSignin.configure({
    webClientId: googleWebClientId,
    ...(googleIosClientId ? { iosClientId: googleIosClientId } : {}),
    offlineAccess: false,
  });
}

export type MobileAuthUser = { id: string; name: string; email: string; image?: string | null };

export const nativeAuthConfigured = Boolean(
  authClient && googleWebClientId && (Platform.OS !== "ios" || googleIosClientId),
);

async function getSessionUser(): Promise<MobileAuthUser | null> {
  if (!authClient) return null;
  const result = await authClient.getSession();
  if (result.error) throw result.error;
  const user = result.data?.user;
  return user ? { id: user.id, name: user.name, email: user.email, image: user.image } : null;
}

async function exchangeGoogleIdToken(idToken: string): Promise<MobileAuthUser> {
  if (!authClient) throw new Error("Set EXPO_PUBLIC_NEON_AUTH_URL to enable Google sign-in.");
  const result = await authClient.signIn.social({
    provider: "google",
    idToken: { token: idToken },
    disableRedirect: true,
  });
  if (result.error) throw result.error;
  const user = await getSessionUser();
  if (!user) throw new Error("Google signed in, but the GoLive session could not be restored.");
  return user;
}

export async function restoreNativeAuthSession(): Promise<MobileAuthUser | null> {
  if (!authClient || !googleWebClientId) return null;
  try {
    const existing = await getSessionUser();
    if (existing) return existing;
    if (!GoogleSignin.hasPreviousSignIn()) return null;
    const response = await GoogleSignin.signInSilently();
    if (response.type !== "success" || !response.data.idToken) return null;
    return await exchangeGoogleIdToken(response.data.idToken);
  } catch {
    return null;
  }
}

export async function signInWithGoogle(): Promise<MobileAuthUser | null> {
  if (!authClient || !googleWebClientId) {
    throw new Error("Set the Neon Auth URL and Google Web Client ID to enable sign-in.");
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type !== "success") return null;
  if (!response.data.idToken) throw new Error("Google did not return an ID token.");
  return exchangeGoogleIdToken(response.data.idToken);
}

export async function signOutNativeAuth(): Promise<void> {
  if (authClient) {
    const result = await authClient.signOut();
    if (result.error) throw result.error;
  }
  if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut();
}

export async function getNativeAuthAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const user = await getSessionUser();
  if (!user) return null;
  // Fetch directly to bypass the SDK's cached /get-session interception.
  return fetchNeonAuthToken(neonAuthUrl!);
}
