import type { WebSocket } from "ws";

export type Peer = {
  id: string;
  name: string;
  sharing: boolean;
};

export type Client = Peer & {
  sessionId: string;
  socket: WebSocket;
};

export type RoomSession = {
  kind: "room";
  sessionId: string;
  roomId: string;
  name: string;
};

export type RoomToken = {
  sessionId: string;
  roomId: string;
  name: string;
};
