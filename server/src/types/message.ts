import type { Client } from "./room.js";

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "join"; room: string; name: string }
  | { type: "signal"; target: string; data: unknown }
  | { type: "sharing"; sharing: boolean };

export type Membership = {
  roomId: string;
  client: Client;
};