import { useEffect, useState } from "react";
import { DeviceRequestError, joinRoom, restoreRoom, verifyInvite } from "@golive/core";
import type { JoinRoomResult } from "@golive/core";
import { roomFromPath, inviteTokenFromUrl, clearInviteTokenFromUrl } from "./utils/room";
import { Landing } from "./components/Landing";
import { NameGate } from "./components/NameGate";
import { Room } from "./components/Room";
import { SessionReplaced } from "./components/SessionReplaced";
import { Admin } from "./components/Admin";
import { DeviceRooms } from "./components/DeviceRooms";
import { DeviceProfile } from "./components/DeviceProfile";
import { primeNotificationAudio } from "./utils/notificationSounds";
import { Brand } from "./components/Brand";
import { SwitchRoomDialog } from "./components/SwitchRoomDialog";
import { VersionInfo } from "./components/VersionInfo";
import { configuredBaseUrl } from "./services/sessionDeps";
import { clearDeviceToken, clearSavedRoom, loadDeviceToken, loadSavedRoom, saveDeviceName, saveDeviceRoom } from "./utils/session";
import { ErrorBoundary } from "./components/ErrorBoundary";

type Join = { name: string; token: string };

function RoomApp() {
  const roomId = roomFromPath();
  const inviteToken = inviteTokenFromUrl();
  const [join, setJoin] = useState<Join | null>(null);
  const [loading, setLoading] = useState(() => Boolean(roomFromPath() && loadDeviceToken()));
  const [error, setError] = useState("");
  const [replaced, setReplaced] = useState(false);
  const [switchFromRoom, setSwitchFromRoom] = useState<string | null>(null);
  const [leavingError, setLeavingError] = useState(false);

  const acceptResult = (result: JoinRoomResult) => {
    if (!roomId) return;
    const deviceToken = result.deviceToken ?? loadDeviceToken();
    if (!deviceToken) {
      setError("Could not save this device profile. Reload and try again.");
      return;
    }
    saveDeviceName(result.session.name);
    saveDeviceRoom(roomId, deviceToken);
    clearInviteTokenFromUrl();
    setJoin({ name: result.session.name, token: result.token });
    setError("");
    setSwitchFromRoom(null);
  };

  const acceptInviteForDevice = async () => {
    if (!roomId || !inviteToken) return;
    const deviceToken = loadDeviceToken();
    if (!deviceToken) {
      setSwitchFromRoom(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      acceptResult(await verifyInvite(configuredBaseUrl(), roomId, undefined, inviteToken, deviceToken));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not accept this invite.";
      setError(message.includes(": 403") || message.toLowerCase().includes("invite")
        ? "This invite is invalid or has expired."
        : "Could not accept this invite. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (!roomId) {
        setLoading(false);
        return;
      }
      const deviceToken = loadDeviceToken();
      if (!deviceToken) {
        setLoading(false);
        return;
      }

      try {
        const restored = await restoreRoom(configuredBaseUrl(), deviceToken, roomId);
        if (cancelled) return;
        acceptResult(restored);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof DeviceRequestError && caught.status === 401) {
          clearDeviceToken();
          setLoading(false);
          return;
        }

        if (caught instanceof DeviceRequestError && caught.status === 404) {
          if (inviteToken) {
            const savedRoomId = loadSavedRoom();
            if (savedRoomId && savedRoomId !== roomId) {
              setSwitchFromRoom(savedRoomId);
              return;
            }
            try {
              const invited = await verifyInvite(configuredBaseUrl(), roomId, undefined, inviteToken, deviceToken);
              if (cancelled) return;
              acceptResult(invited);
            } catch (inviteError) {
              if (cancelled) return;
              const message = inviteError instanceof Error ? inviteError.message : "Invalid invite";
              setError(message.includes(": 403") || message.toLowerCase().includes("invite")
                ? "This invite is invalid or has expired."
                : "Could not accept this invite. Check your connection and retry.");
            }
            return;
          }

          try {
            const created = await joinRoom(configuredBaseUrl(), roomId, undefined, deviceToken);
            if (cancelled) return;
            acceptResult(created);
          } catch (joinError) {
            if (cancelled) return;
            const message = joinError instanceof Error ? joinError.message : "Could not enter the room.";
            setError(message.includes(": 403")
              ? "This room requires a valid invite link."
              : "Could not open this room. Check your connection and retry.");
          }
          return;
        }

        setError("Could not restore your room. Check your connection and retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void restore();
    return () => { cancelled = true; };
  }, [roomId, inviteToken]);

  const rejectSession = async () => {
    const deviceToken = loadDeviceToken();
    if (!deviceToken) { setJoin(null); window.location.assign("/rooms"); return; }
    try {
      const result = await restoreRoom(configuredBaseUrl(), deviceToken, roomId ?? undefined);
      acceptResult(result);
      setReplaced(false);
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 404) {
        clearSavedRoom();
        window.location.replace("/rooms");
      } else if (caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        window.location.replace("/");
      } else {
        setError("Could not restore your room. Reload to try again.");
      }
    }
  };

  const leave = () => {
    clearSavedRoom();
    window.location.assign("/rooms");
  };

  const leaveWithoutConnection = () => {
    if (leavingError) return;
    setLeavingError(true);
    clearSavedRoom();
    window.location.assign("/rooms");
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
        <button className="gate-leave-button" onClick={leaveWithoutConnection} disabled={leavingError}>
          {leavingError ? "Leaving..." : "Back to my rooms"}
        </button>
      </div>
    </main>
  );
  if (switchFromRoom) return (
    <main className="gate-shell">
      <Brand />
      <SwitchRoomDialog
        onStay={() => window.location.replace(`/room/${switchFromRoom}`)}
        onSwitch={() => void acceptInviteForDevice()}
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
    onLeave={leave} onLeaveDisconnected={leaveWithoutConnection} onSessionRejected={() => void rejectSession()}
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

  const pathname = window.location.pathname;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <Admin />;

  return (
    <ErrorBoundary>
      <VersionInfo />
      {pathname === "/rooms" ? <DeviceRooms /> : pathname === "/profile" ? <DeviceProfile /> : <RoomApp />}
    </ErrorBoundary>
  );
}
