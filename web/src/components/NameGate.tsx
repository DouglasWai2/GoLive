import { FormEvent, useState } from "react";
import { Brand } from "./Brand";

type NameGateProps = {
  roomId: string;
  onJoin: (name: string) => void;
};

export function NameGate({ roomId, onJoin }: NameGateProps) {
  const [name, setName] = useState(() => localStorage.getItem("golive-name") ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 32) return;
    localStorage.setItem("golive-name", trimmed);
    onJoin(trimmed);
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
        <button className="primary-button" type="submit" disabled={!name.trim()}>
          Enter the room <span>→</span>
        </button>
        <small>Your camera and microphone stay off.</small>
      </form>
    </main>
  );
}