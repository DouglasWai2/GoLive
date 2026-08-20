import { useState } from "react";
import { CopyIcon } from "../icons";
import { Brand } from "../Brand";
import { buildInviteUrl, createInvite } from "@golive/core";
import { configuredBaseUrl } from "../../services/sessionDeps";
import type { SocketStatus } from "../../types";

type RoomHeaderProps = {
  roomId: string;
  token: string;
  status: SocketStatus;
  onLeave: () => void;
};

export function RoomHeader({ roomId, token, status, onLeave }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);

  const copyInvite = async () => {
    if (creating) return;

    setCreating(true);
    setError(false);

    try {
      const inviteToken = await createInvite(configuredBaseUrl(), roomId, token);
      const url = buildInviteUrl(window.location.origin, roomId, inviteToken);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (caught) {
      setError(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <header className="room-header">
      <Brand />
      <div className="room-identity">
        <span>ROOM</span>
        <strong>{roomId}</strong>
      </div>
      <div className="header-actions">
        <span className={`socket-state ${status}`}><i />{status}</span>
        <button className="icon-button" onClick={copyInvite} disabled={creating}>
          <CopyIcon /> {creating ? "Creating…" : copied ? "Copied" : "Copy invite"}
        </button>
        {error && <span className="invite-error">Could not create invite</span>}
        <button className="leave-button" onClick={onLeave}>
          Leave
        </button>
      </div>
    </header>
  );
}