import { FormEvent, useState } from "react";
import { CopyIcon, ScreenIcon, UsersIcon } from "./icons";
import { useRoom } from "./useRoom";
import { VideoTile } from "./VideoTile";

function createRoomId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function roomFromPath(): string | null {
  const match = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]{1,64})\/?$/);
  return match?.[1] ?? null;
}

function goToRoom(roomId: string) {
  window.location.assign(`/room/${roomId}`);
}

function Landing() {
  const [roomCode, setRoomCode] = useState("");

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    const normalized = roomCode.trim().replace(/^.*\/room\//, "");
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(normalized)) goToRoom(normalized);
  };

  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <a className="brand" href="/" aria-label="GoLive home">
          <span className="brand-mark"><span /></span>
          GoLive
        </a>
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

function NameGate({ roomId, onJoin }: { roomId: string; onJoin: (name: string) => void }) {
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
      <a className="brand" href="/">
        <span className="brand-mark"><span /></span>GoLive
      </a>
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

function Room({ roomId, name }: { roomId: string; name: string }) {
  const room = useRoom(roomId, name);
  const [copied, setCopied] = useState(false);
  const activeSharer = room.peers.find((peer) => peer.sharing);
  const remoteTiles = room.peers.filter((peer) => room.remoteStreams[peer.id]);
  const canShare = room.status === "connected" && !activeSharer && !room.localStream && !room.isStartingShare;

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="room-shell">
      <header className="room-header">
        <a className="brand" href="/">
          <span className="brand-mark"><span /></span>GoLive
        </a>
        <div className="room-identity">
          <span>ROOM</span>
          <strong>{roomId}</strong>
        </div>
        <div className="header-actions">
          <span className={`socket-state ${room.status}`}><i />{room.status}</span>
          <button className="icon-button" onClick={copyInvite}>
            <CopyIcon /> {copied ? "Copied" : "Copy invite"}
          </button>
        </div>
      </header>

      {room.error && (
        <div className="error-banner" role="alert">
          <span>{room.error}</span>
          <button onClick={() => room.setError("")} aria-label="Dismiss">×</button>
        </div>
      )}

      <section className="stage">
        <div className="stage-heading">
          <div>
            <p className="eyebrow"><span /> Live room</p>
            <h1>{room.localStream ? "You are presenting" : activeSharer ? `${activeSharer.name} is presenting` : "Ready when you are"}</h1>
          </div>
          <div className="people-count"><UsersIcon /><strong>{room.peers.length + 1}</strong> in room</div>
        </div>

        <div className={`video-grid ${room.localStream || remoteTiles.length ? "has-video" : ""}`}>
          {room.localStream && <VideoTile stream={room.localStream} name={name} local />}
          {remoteTiles.map((peer) => (
            <VideoTile
              key={peer.id}
              stream={room.remoteStreams[peer.id]!}
              name={peer.name}
              state={room.connectionStates[peer.id]}
            />
          ))}
          {!room.localStream && remoteTiles.length === 0 && (
            <div className="empty-stage">
              <div className="screen-outline"><ScreenIcon size={38} /><span className="scan-line" /></div>
              <h2>{activeSharer ? "Connecting to the screen..." : "No screen on air"}</h2>
              <p>{activeSharer ? "A secure peer-to-peer connection is being established." : "Share this room link, then choose a window or display to begin."}</p>
            </div>
          )}
        </div>
      </section>

      <footer className="control-dock">
        <div className="you-chip"><span>{name.slice(0, 1).toUpperCase()}</span><div><small>YOU</small><strong>{name}</strong></div></div>
        {room.localStream ? (
          <button className="stop-button" onClick={room.stopSharing}><span /> Stop sharing</button>
        ) : (
          <button className="primary-button" onClick={room.startSharing} disabled={!canShare}>
            <ScreenIcon /> {room.isStartingShare ? "Choose a screen..." : activeSharer ? "Screen in use" : "Share screen"}
          </button>
        )}
        <div className="privacy-note"><i>↗</i><span><strong>Direct connection</strong><small>Media never touches our server</small></span></div>
      </footer>
    </main>
  );
}

export default function App() {
  const roomId = roomFromPath();
  const [name, setName] = useState<string | null>(null);

  if (!roomId) return <Landing />;
  if (!name) return <NameGate roomId={roomId} onJoin={setName} />;
  return <Room roomId={roomId} name={name} />;
}
