import { useState } from "react";
import { CheckIcon, CopyIcon } from "../icons";
import { Brand } from "../Brand";
import { buildInviteUrl, createInvite } from "@golive/core";
import { configuredBaseUrl } from "../../services/sessionDeps";
import type { SocketStatus } from "../../types";

type RoomHeaderProps = {
  roomId: string;
  token: string;
  status: SocketStatus;
};

export function RoomHeader({ roomId, token, status }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);

  const copyInvite = async () => {
    if (creating) return;

    setCreating(true);
    setCopied(false);
    setError(false);

    try {
      const inviteToken = await createInvite(configuredBaseUrl(), roomId, token);
      const url = buildInviteUrl(window.location.origin, roomId, inviteToken);

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
          return;
        } catch {
          // Clipboard writes require a secure context in some browsers.
        }
      }

      window.prompt("Copy this invite link:", url);
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
        <button type="button" className={`icon-button header-invite ${copied && !creating ? "is-copied" : ""}`} onClick={copyInvite} disabled={creating} aria-busy={creating} title={creating ? "Creating invite" : copied ? "Invite copied" : "Copy invite"} aria-label={creating ? "Creating invite" : copied ? "Invite copied" : "Copy invite"}>
          {creating ? <span className="room-restore-spinner invite-spinner" aria-hidden="true" /> : copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{creating ? "Creating invite…" : copied ? "Invite copied" : error ? "Could not create invite" : ""}</span>
        {error && <span className="invite-error">Could not create invite</span>}
      </div>
    </header>
  );
}
