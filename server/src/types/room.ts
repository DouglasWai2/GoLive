import type { WebSocket } from "ws";

export type Peer = {
  id: string;
  name: string;
  sharing: boolean;
};

export type Client = Peer & {
  socket: WebSocket;
};