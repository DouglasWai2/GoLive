import type { Client } from "./room.js";

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "join"; room: string; name: string }
  | {
      type: "signal";
      target: string;
      channel: "screen" | "voice";
      streamId?: string;
      data: unknown;
    }
  | { type: "sharing"; sharing: boolean; streamId?: string }
  | { type: "subscribe"; streamId: string | null }
  | { type: "voice"; joined: boolean; micMuted: boolean }
  | { type: "ping"; timestamp: number };

export type Membership = {
  roomId: string;
  client: Client;
};
