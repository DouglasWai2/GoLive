import { FormEvent, useState } from "react";
import { Brand } from "./Brand";
import { joinRoom, verifyInvite } from "@golive/core";
import { configuredBaseUrl } from "../services/sessionDeps";
import { saveSession } from "../utils/session";

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
      const { token } = inviteToken
        ? await verifyInvite(configuredBaseUrl(), roomId, trimmed, inviteToken)
        : await joinRoom(configuredBaseUrl(), roomId, trimmed);
      localStorage.setItem("golive-name", trimmed);
      saveSession(roomId, trimmed, token, inviteToken ?? undefined);
      onJoin(trimmed, token);
    } catch (caught) {
      setError(
        inviteToken
          ? "This invite is invalid or has expired."
          : "This room requires an invite link to join.",
      );
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