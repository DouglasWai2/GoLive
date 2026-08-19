import { useState } from "react";
import { CopyIcon } from "../icons";
import { Brand } from "../Brand";
import type { SocketStatus } from "../../types";

type RoomHeaderProps = {
  roomId: string;
  status: SocketStatus;
};

export function RoomHeader({ roomId, status }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
        <button className="icon-button" onClick={copyInvite}>
          <CopyIcon /> {copied ? "Copied" : "Copy invite"}
        </button>
      </div>
    </header>
  );
}