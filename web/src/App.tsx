import { useEffect, useState } from "react";
import { DeviceRequestError, leaveRoom, restoreRoom } from "@golive/core";
import { roomFromPath, inviteTokenFromUrl, clearInviteTokenFromUrl } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";
import { SessionReplaced } from "./components/SessionReplaced";
import { Admin } from "./components/Admin";
import { primeNotificationAudio } from "./utils/notificationSounds";
import { Brand } from "./components/Brand";
import { SwitchRoomDialog } from "./components/SwitchRoomDialog";
import { VersionInfo } from "./components/VersionInfo";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { configuredBaseUrl } from "./services/sessionDeps";
import { clearDeviceToken, clearSavedRoom, loadDeviceToken, saveDeviceRoom } from "./utils/session";

type Join = { name: string; token: string };

function RoomApp() {
  const roomId = roomFromPath();
  const inviteToken = inviteTokenFromUrl();
  const [join, setJoin] = useState<Join | null>(null);
  const [loading, setLoading] = useState(() => Boolean(loadDeviceToken()));
  const [error, setError] = useState("");
  const [replaced, setReplaced] = useState(false);
  const [switchFromRoom, setSwitchFromRoom] = useState<string | null>(null);
  const [leavingError, setLeavingError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let redirecting = false;
    const restore = async () => {
      const deviceToken = loadDeviceToken();
      if (!deviceToken) { setLoading(false); return; }
      try {
        const result = await restoreRoom(configuredBaseUrl(), deviceToken);
        if (cancelled) return;
        const savedRoomId = result.session.roomId;
        saveDeviceRoom(savedRoomId, deviceToken);
        if (roomId && inviteToken && savedRoomId !== roomId) {
          setSwitchFromRoom(savedRoomId);
          return;
        }
        if (roomId !== savedRoomId) {
          redirecting = true;
          window.location.replace(`/room/${savedRoomId}`);
          return;
        }
        clearInviteTokenFromUrl();
        setJoin({ name: result.session.name, token: result.token });
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof DeviceRequestError && caught.status === 404) {
          clearSavedRoom();
        } else if (caught instanceof DeviceRequestError && caught.status === 401) {
          clearDeviceToken();
        } else {
          setError("Could not restore your room. Check your connection and retry.");
        }
      } finally {
        if (!cancelled && !redirecting) setLoading(false);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [roomId, inviteToken]);

  const rejectSession = async () => {
    const deviceToken = loadDeviceToken();
    if (!deviceToken) { setJoin(null); return; }
    try {
      const result = await restoreRoom(configuredBaseUrl(), deviceToken);
      if (result.session.roomId !== roomId) {
        window.location.replace(`/room/${result.session.roomId}`);
        return;
      }
      setJoin({ name: result.session.name, token: result.token });
      setReplaced(false);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 404) {
        clearSavedRoom();
        window.location.replace("/");
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        window.location.replace("/");
      } else {
        setError("Could not restore your room. Reload to try again.");
      }
    }
  };

  const leave = async () => {
    const deviceToken = loadDeviceToken();
    if (!deviceToken) return;
    try {
      await leaveRoom(configuredBaseUrl(), deviceToken);
      clearSavedRoom();
      window.location.assign("/");
    } catch {
      setError("Could not leave the room. Please retry.");
    }
  };

  const leaveWithoutConnection = async () => {
    if (leavingError) return;
    setLeavingError(true);
    const deviceToken = loadDeviceToken();
    if (deviceToken) {
      try { await leaveRoom(configuredBaseUrl(), deviceToken); } catch { /* Allow leaving while offline. */ }
    }
    clearDeviceToken();
    window.location.assign("/");
  };

  if (loading) return (
    <main className="gate-shell room-restore" aria-live="polite">
      <Brand />
      <div className="room-restore-status" role="status">
        <span className="room-restore-spinner" aria-hidden="true" />
        Restoring your room...
      </div>
    </main>
  );
  if (error) return (
    <main className="gate-shell">
      <Brand />
      <div className="name-card">
        <p role="alert">{error}</p>
        <button className="primary-button" onClick={() => window.location.reload()} disabled={leavingError}>Retry</button>
        <button className="gate-leave-button" onClick={() => void leaveWithoutConnection()} disabled={leavingError}>
          {leavingError ? "Leaving..." : "Leave room"}
        </button>
      </div>
    </main>
  );
  if (switchFromRoom) return (
    <main className="gate-shell">
      <Brand />
      <SwitchRoomDialog
        onStay={() => window.location.replace(`/room/${switchFromRoom}`)}
        onSwitch={() => setSwitchFromRoom(null)}
      />
    </main>
  );
  if (!roomId) return <Landing />;
  if (!join) return <NameGate roomId={roomId} inviteToken={inviteToken} onJoin={(name, token) => {
    clearInviteTokenFromUrl();
    setJoin({ name, token });
  }} />;

  if (replaced) return <SessionReplaced roomId={roomId} onReconnect={() => setReplaced(false)} />;
  return <Room roomId={roomId} name={join.name} token={join.token}
    onLeave={() => void leave()} onLeaveDisconnected={() => void leaveWithoutConnection()} onSessionRejected={() => void rejectSession()}
    onSessionReplaced={() => setReplaced(true)} />;
}

export default function App() {
  useEffect(() => {
    const removeAudioPrimingListeners = () => {
      window.removeEventListener("pointerdown", primeAudio);
      window.removeEventListener("keydown", primeAudio);
    };
    const primeAudio = () => {
      void primeNotificationAudio().then((ready) => {
        if (ready) removeAudioPrimingListeners();
      });
    };

    window.addEventListener("pointerdown", primeAudio);
    window.addEventListener("keydown", primeAudio);

    return removeAudioPrimingListeners;
  }, []);

  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) {
    return <Admin />;
  }
  return (
    <ErrorBoundary>
      <VersionInfo />
      <RoomApp />
    </ErrorBoundary>
  );
}
