import { FormEvent, useState } from "react";
import { Brand } from "./Brand";
import { joinRoom } from "../utils/signaling";
import { saveSession } from "../utils/session";

type NameGateProps = {
  roomId: string;
  onJoin: (name: string, token: string) => void;
};

export function NameGate({ roomId, onJoin }: NameGateProps) {
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
      const { token } = await joinRoom(roomId, trimmed);
      localStorage.setItem("golive-name", trimmed);
      saveSession(roomId, trimmed, token);
      onJoin(trimmed, token);
    } catch (caught) {
      setError("Could not enter the room. Try again.");
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