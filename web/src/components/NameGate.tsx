import { FormEvent, useState } from "react";
import { Brand } from "./Brand";
import { joinRoom, verifyInvite } from "@golive/core";
import { configuredBaseUrl } from "../services/sessionDeps";
import { loadDeviceToken, saveDeviceRoom } from "../utils/session";

type NameGateProps = {
  roomId: string;
  inviteToken?: string | null;
  onJoin: (name: string, token: string) => void;
};

export function NameGate({ roomId, inviteToken = null, onJoin }: NameGateProps) {
  const [name, setName] = useState(() => localStorage.getItem("golive-name") ?? "");
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
        ? await verifyInvite(configuredBaseUrl(), roomId, trimmed, inviteToken, loadDeviceToken() ?? undefined)
        : await joinRoom(configuredBaseUrl(), roomId, trimmed, loadDeviceToken() ?? undefined);
      if (!deviceToken) throw new Error("Missing device credential");
      localStorage.setItem("golive-name", trimmed);
      saveDeviceRoom(roomId, deviceToken);
      onJoin(trimmed, token);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not enter the room.";
      setError(message.includes(": 403")
        ? "This room requires a valid invite link."
        : message.includes(": 409")
          ? "Leave your current room before creating another."
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
        {error && <p className="gate-error">{error}</p>}
        <button
          className="primary-button"
          type="submit"
          disabled={!name.trim() || joining}
        >
          {joining ? "Entering…" : "Enter the room"} <span>→</span>
        </button>
        <small>Your camera and microphone stay off.</small>
      </form>
    </main>
  );
}
