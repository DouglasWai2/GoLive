import type { Client } from "./room.js";

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "join"; room: string; name: string }
  | {
      type: "signal";
      target: string;
      channel: "screen" | "voice";
      data: unknown;
    }
  | { type: "sharing"; sharing: boolean }
  | { type: "voice"; joined: boolean; micMuted: boolean }
  | { type: "ping"; timestamp: number }
  | { type: "heartbeat-reclaim" };
  

export type Membership = {
  roomId: string;
  client: Client;
};
