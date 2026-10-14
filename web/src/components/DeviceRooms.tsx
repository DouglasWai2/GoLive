import { useEffect, useState } from "react";
import { DeviceRequestError, endAccountRoom, listAccountRooms, listDeviceRooms, removeDeviceRoom, type DeviceRoom } from "@golive/core";
import { Brand } from "./Brand";
import { configuredBaseUrl } from "../services/sessionDeps";
import { createRoomId, goToRoom } from "../utils/room";
import { clearDeviceToken, clearSavedRoom, loadDeviceToken, loadSavedRoom } from "../utils/session";
import { GoogleAuthControls } from "./GoogleAuthControls";
import { useAuth } from "../services/auth";

export function DeviceRooms() {
  const auth = useAuth();
  const [deviceToken, setDeviceToken] = useState(loadDeviceToken);
  const [rooms, setRooms] = useState<DeviceRoom[]>([]);
  const [ownedRoomCount, setOwnedRoomCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const authToken = await auth.getAccessToken();
      if (!authToken) throw new Error("Account session unavailable");
      const ownedRooms = await listAccountRooms(configuredBaseUrl(), authToken);
      let deviceRooms: DeviceRoom[] = [];
      if (deviceToken) {
        try {
          deviceRooms = await listDeviceRooms(configuredBaseUrl(), deviceToken, authToken);
        } catch (caught) {
          if (!(caught instanceof DeviceRequestError && caught.status === 401)) throw caught;
          if (signal?.aborted) return;
          clearDeviceToken();
          setDeviceToken(null);
        }
      }
      if (!signal?.aborted) {
        setOwnedRoomCount(ownedRooms.length);
        const ownedIds = new Set(ownedRooms.map((room) => room.id));
        setRooms([...ownedRooms, ...deviceRooms.filter((room) => !ownedIds.has(room.id))]);
      }
    } catch (caught) {
      if (signal?.aborted) return;
      setError("Could not load your account rooms. Check your connection and retry.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [deviceToken, auth.getAccessToken]);

  const remove = async (room: DeviceRoom) => {
    if (removing || (!room.owner && !deviceToken)) return;
    if (!window.confirm(room.owner
      ? `End ${room.name} for everyone? All participants will lose access.`
      : `Remove access to ${room.name}? You will need a new invite to return.`)) return;
    setRemoving(room.id);
    setError("");
    try {
      const authToken = await auth.getAccessToken();
      if (!authToken) throw new Error("Account session unavailable");
      if (room.owner) {
        await endAccountRoom(configuredBaseUrl(), authToken, room.id);
        setOwnedRoomCount((count) => Math.max(0, count - 1));
      } else {
        await removeDeviceRoom(configuredBaseUrl(), deviceToken!, room.id, authToken);
      }
      if (loadSavedRoom() === room.id) clearSavedRoom();
      setRooms((current) => current.filter((candidate) => candidate.id !== room.id));
    } catch (caught) {
      if (!room.owner && caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        setDeviceToken(null);
        setError("This device profile is no longer available. Your account rooms are still available.");
      } else {
        setError(room.owner ? "Could not end this room. Please retry." : "Could not remove this room. Please retry.");
      }
    } finally {
      setRemoving(null);
    }
  };

  return (
    <main className="account-shell">
      <nav className="account-nav">
        <Brand ariaLabel="GoLive home" />
        <div className="account-nav-links">
          <a href="/rooms" aria-current="page">My rooms</a>
          {deviceToken && <a href="/profile">Profile</a>}
          <GoogleAuthControls />
        </div>
      </nav>
      <section className="account-content">
        <p className="eyebrow"><span /> Your GoLive</p>
        <div className="account-title-row">
          <div>
            <h1>My rooms</h1>
            <p className="account-description">Rooms owned by your Google account and invites saved on this device.</p>
          </div>
          {!loading && ownedRoomCount < 5 && <button className="primary-button" type="button" onClick={() => goToRoom(createRoomId())}>Create a room <span>→</span></button>}
        </div>

        {loading ? <p className="account-status" role="status">Loading your rooms…</p> : null}
        {!loading && ownedRoomCount >= 5 && <p className="account-status">You have five active rooms. End one to create another.</p>}
        {error ? <div className="account-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
        {!loading && !error && rooms.length === 0 ? (
          <div className="account-empty-state">
            <h2>No rooms yet</h2>
            <p>Create a room with your Google account or accept an invite to get started.</p>
            <button className="primary-button" type="button" onClick={() => goToRoom(createRoomId())}>Create a room <span>→</span></button>
          </div>
        ) : null}
        {rooms.length > 0 ? (
          <ul className="device-room-list">
            {rooms.map((room) => (
              <li className="device-room-card" key={room.id}>
                <div className="device-room-copy">
                  <p className="device-room-eyebrow">{room.owner ? "Your room" : "Invited room"}</p>
                  <h2>{room.name}</h2>
                  <code>{room.id}</code>
                </div>
                <div className="device-room-actions">
                  <button className="primary-button" type="button" onClick={() => goToRoom(room.id)}>Enter <span>→</span></button>
                  <button className="room-remove-button" type="button" disabled={removing !== null} onClick={() => void remove(room)}>
                    {removing === room.id ? (room.owner ? "Ending…" : "Removing…") : (room.owner ? "End room" : "Remove access")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
