import { FormEvent, useState } from "react";
import { Brand } from "./Brand";
import { joinRoom, verifyInvite } from "@golive/core";
import { configuredBaseUrl } from "../services/sessionDeps";
import { loadDeviceName, loadDeviceToken, saveDeviceName, saveDeviceRoom } from "../utils/session";
import { useAuth } from "../services/auth";

type NameGateProps = {
  roomId: string;
  inviteToken?: string | null;
  onJoin: (name: string, token: string) => void;
};

export function NameGate({ roomId, inviteToken = null, onJoin }: NameGateProps) {
  const auth = useAuth();
  const [name, setName] = useState(loadDeviceName);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 32) return;

    setJoining(true);
    setError("");

    try {
      const { token, deviceToken } = inviteToken
        ? await verifyInvite(
            configuredBaseUrl(), roomId, trimmed, inviteToken, loadDeviceToken() ?? undefined,
            await auth.getAccessToken() ?? undefined,
          )
        : await joinRoom(
            configuredBaseUrl(),
            roomId,
            trimmed,
            loadDeviceToken() ?? undefined,
            await auth.getAccessToken() ?? undefined,
          );
      if (!deviceToken) throw new Error("Missing device credential");
      saveDeviceName(trimmed);
      saveDeviceRoom(roomId, deviceToken);
      onJoin(trimmed, token);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not enter the room.";
      setError(message.includes(": 403")
        ? "This room requires a valid invite link."
        : message.includes(": 409")
          ? message.includes("Guests can keep access")
            ? auth.configured
              ? "Remove access to your current room from My rooms before creating another, or sign in with Google."
              : "Remove access to your current room before creating another."
            : message.includes("five active rooms")
              ? "You already have five active rooms. End one in My rooms before creating another."
              : "This device has reached its room limit. Remove access to a room in My rooms before creating another."
          : message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <main className="gate-shell">
      <Brand />
      <form className="name-card" onSubmit={submit}>
        <p className="eyebrow"><span /> Room {roomId}</p>
        <h1>How should people see you?</h1>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          autoFocus
          maxLength={32}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
        />
        {error && <p className="gate-error" role="alert">{error} {error.includes("My rooms") && <a href="/rooms">Open My rooms</a>}</p>}
        <button
          className="primary-button"
          type="submit"
          disabled={!name.trim() || joining || auth.loading}
        >
          {joining ? "Entering…" : "Enter the room"} <span>→</span>
        </button>
        <small>Your camera and microphone stay off.</small>
      </form>
    </main>
  );
}
