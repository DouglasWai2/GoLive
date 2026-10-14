import { useAuth } from "../services/auth";

export function GoogleAuthControls() {
  const auth = useAuth();
  if (!auth.configured) return null;

  return (
    <div className="google-auth-controls">
      {auth.user ? (
        <>
          <span className="google-auth-user" title={auth.user.email}>{auth.user.name || auth.user.email}</span>
          <button className="google-auth-button google-auth-sign-out" type="button" onClick={() => void auth.signOut()} disabled={auth.busy}>
            {auth.busy ? "Signing out…" : "Sign out"}
          </button>
        </>
      ) : (
        <button className="google-auth-button" type="button" onClick={() => void auth.signInWithGoogle()} disabled={auth.busy || auth.loading}>
          {auth.busy ? "Opening Google…" : "Sign in with Google"}
        </button>
      )}
      {auth.error && <span className="google-auth-error" role="alert">{auth.error}</span>}
    </div>
  );
}
