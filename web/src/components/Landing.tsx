import { FormEvent, useState } from "react";
import { ScreenIcon } from "./icons";
import { Brand } from "./Brand";
import { createRoomId, goToRoom, normalizeRoomCode } from "../utils/room";

export function Landing() {
  const [roomCode, setRoomCode] = useState("");

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRoomCode(roomCode);
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(normalized)) goToRoom(normalized);
  };

  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Brand ariaLabel="GoLive home" />
        <span className="nav-note">Browser to browser. Nothing recorded.</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Direct screen sharing</p>
          <h1>Your screen.<br /><em>Their browser.</em></h1>
          <p className="hero-intro">
            Start a room and share your screen with a link. No installs,
            accounts, or video servers in the middle.
          </p>
          <button className="primary-button large" onClick={() => goToRoom(createRoomId())}>
            <ScreenIcon size={21} />
            Create a room
          </button>
        </div>

        <div className="hero-panel" aria-hidden="true">
          <div className="panel-topbar">
            <span className="panel-pill"><i /> LIVE</span>
            <span>golive / studio-08</span>
          </div>
          <div className="screen-mock">
            <div className="mock-window">
              <div className="mock-sidebar" />
              <div className="mock-content">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="signal-lines"><i /><i /><i /></div>
          </div>
          <div className="panel-footer">
            <span>1080p</span><span>30 fps</span><span>P2P encrypted</span>
          </div>
        </div>
      </section>

      <section className="join-strip">
        <div>
          <span className="step-number">02</span>
          <div><strong>Already invited?</strong><small>Paste a room code or invite link.</small></div>
        </div>
        <form onSubmit={joinRoom}>
          <input
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            placeholder="Room code"
            aria-label="Room code or invite link"
          />
          <button type="submit">Join room <span>→</span></button>
        </form>
      </section>
    </main>
  );
}