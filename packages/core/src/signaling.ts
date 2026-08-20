import type { IceServer } from "./types";

export const fallbackIceServers: IceServer[] = [
  {
    urls: [
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
    ],
  },
];

export function signalingHttpUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);

  // In case the configured URL was provided as ws/wss.
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  }

  if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = path;
  url.search = "";
  url.hash = "";

  return url.toString();
}

export function websocketUrl(baseUrl: string): string {
  const url = new URL(signalingHttpUrl(baseUrl, "/ws"));

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return url.toString();
}

export type JoinRoomResult = {
  session: {
    kind: "room";
    sessionId: string;
    roomId: string;
    name: string;
  };
  token: string;
};

export async function joinRoom(
  baseUrl: string,
  roomId: string,
  name: string,
): Promise<JoinRoomResult> {
  const response = await fetch(signalingHttpUrl(baseUrl, "/room"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomId, name }),
  });

  if (!response.ok) {
    throw new Error(`Failed to join room: ${response.status}`);
  }

  return (await response.json()) as JoinRoomResult;
}

export async function getIceServers(
  baseUrl: string,
  token: string,
): Promise<IceServer[]> {
  const response = await fetch(signalingHttpUrl(baseUrl, "/turn-credentials"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get TURN credentials: ${response.status}`);
  }

  const data = (await response.json()) as { iceServers?: IceServer[] };

  if (!Array.isArray(data.iceServers)) {
    throw new Error("TURN credentials response did not contain iceServers");
  }

  return data.iceServers;
}