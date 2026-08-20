import { Brand } from "./Brand";

type SessionReplacedProps = {
  roomId: string;
  onReconnect: () => void;
};

export function SessionReplaced({ roomId, onReconnect }: SessionReplacedProps) {
  return (
    <main className="gate-shell">
      <Brand />
      <form className="name-card" onSubmit={(event) => { event.preventDefault(); onReconnect(); }}>
        <p className="eyebrow"><span /> Room {roomId}</p>
        <h1>Connected in another tab</h1>
        <p className="replaced-note">
          This room is open in another tab with the same session. Move it here to
          take over that connection.
        </p>
        <button className="primary-button" type="submit">
          Connect here instead <span>→</span>
        </button>
      </form>
    </main>
  );
}