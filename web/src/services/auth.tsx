import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla/adapters";
import { fetchNeonAuthToken, NeonAuthTokenError } from "@golive/core";

const neonAuthUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
const googleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === undefined
  ? import.meta.env.DEV
  : import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
const authClient = googleAuthEnabled && neonAuthUrl
  ? createAuthClient(neonAuthUrl, {
      adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: "include" } }),
    })
  : null;

export type AuthUser = { id: string; name: string; email: string; image?: string | null };

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  busy: boolean;
  user: AuthUser | null;
  error: string;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(Boolean(authClient));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshSession = useCallback(async () => {
    if (!authClient) {
      setLoading(false);
      return;
    }
    try {
      const result = await authClient.getSession();
      if (result.error) throw result.error;
      const candidate = result.data?.user;
      const nextUser = candidate ? {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        image: candidate.image,
      } : null;
      setUser((current) => {
        if (!current || !nextUser) return current === nextUser ? current : nextUser;
        if (
          current.id === nextUser.id
          && current.name === nextUser.name
          && current.email === nextUser.email
          && current.image === nextUser.image
        ) return current;
        return nextUser;
      });
    } catch {
      // Keep the current identity if a focus refresh fails transiently.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    window.addEventListener("focus", refreshSession);
    return () => window.removeEventListener("focus", refreshSession);
  }, [refreshSession]);

  const signInWithGoogle = useCallback(async () => {
    if (!authClient) {
      setError("Google sign-in is not configured for this deployment.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.href,
      });
      if (result.error) throw result.error;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in with Google.");
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!authClient) return;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      setUser(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }, []);

  const getAccessToken = useCallback(async () => {
    if (!authClient || !user?.id) return null;
    try {
      // The Neon adapter can serve /token from its cached /get-session response,
      // which may not contain the set-auth-jwt token after social sign-in.
      return await fetchNeonAuthToken(neonAuthUrl!);
    } catch (caught) {
      if (caught instanceof NeonAuthTokenError && caught.status === 401) setUser(null);
      throw caught;
    }
  }, [user?.id]);

  const value = useMemo<AuthContextValue>(() => ({
    configured: Boolean(authClient),
    loading,
    busy,
    user,
    error,
    signInWithGoogle,
    signOut,
    getAccessToken,
    clearError: () => setError(""),
  }), [loading, busy, user, error, signInWithGoogle, signOut, getAccessToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
