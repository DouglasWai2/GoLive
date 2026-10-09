import { useEffect, useState } from "react";
import { DeviceRequestError, listDeviceRooms, removeDeviceRoom, type DeviceRoom } from "@golive/core";
import { Brand } from "./Brand";
import { configuredBaseUrl } from "../services/sessionDeps";
import { createRoomId, goToRoom } from "../utils/room";
import { clearDeviceToken, clearSavedRoom, loadDeviceToken, loadSavedRoom } from "../utils/session";

export function DeviceRooms() {
  const [deviceToken, setDeviceToken] = useState(loadDeviceToken);
  const [rooms, setRooms] = useState<DeviceRoom[]>([]);
  const [loading, setLoading] = useState(Boolean(deviceToken));
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = async (signal?: AbortSignal) => {
    if (!deviceToken) return;
    setError("");
    try {
      const nextRooms = await listDeviceRooms(configuredBaseUrl(), deviceToken);
      if (!signal?.aborted) setRooms(nextRooms);
    } catch (caught) {
      if (signal?.aborted) return;
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        setDeviceToken(null);
        setRooms([]);
        setError("This device profile is no longer available. Accept an invite to reconnect.");
      } else {
        setError("Could not load your rooms. Check your connection and retry.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [deviceToken]);

  const remove = async (room: DeviceRoom) => {
    if (!deviceToken || removing) return;
    if (!window.confirm(`Remove access to ${room.name}? You will need a new invite to return.`)) return;
    setRemoving(room.id);
    setError("");
    try {
      await removeDeviceRoom(configuredBaseUrl(), deviceToken, room.id);
      if (loadSavedRoom() === room.id) clearSavedRoom();
      setRooms((current) => current.filter((candidate) => candidate.id !== room.id));
    } catch (caught) {
      if (caught instanceof DeviceRequestError && caught.status === 401) {
        clearDeviceToken();
        setDeviceToken(null);
        setRooms([]);
        setError("This device profile is no longer available. Accept an invite to reconnect.");
      } else {
        setError("Could not remove this room. Please retry.");
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
        </div>
      </nav>
      <section className="account-content">
        <p className="eyebrow"><span /> Your GoLive</p>
        <div className="account-title-row">
          <div>
            <h1>My rooms</h1>
            <p className="account-description">Rooms you have access to on this device.</p>
          </div>
          {deviceToken && <button className="primary-button" type="button" onClick={() => goToRoom(createRoomId())}>Create a room <span>→</span></button>}
        </div>

        {loading ? <p className="account-status" role="status">Loading your rooms…</p> : null}
        {error ? <div className="account-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
        {!deviceToken ? (
          <div className="account-empty-state">
            <h2>No device profile yet</h2>
            <p>Accept a room invite or create your first room to start a private list on this device.</p>
            <a className="primary-button" href="/">Go to GoLive <span>→</span></a>
          </div>
        ) : null}
        {!loading && deviceToken && !error && rooms.length === 0 ? (
          <div className="account-empty-state">
            <h2>Your list is ready</h2>
            <p>Rooms you join with this device will appear here so you can return anytime.</p>
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
                    {removing === room.id ? "Removing…" : "Remove access"}
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
