export const fallbackIceServers: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
    ],
  },
];

function signalingHttpUrl(path: string): string {
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined;

  const url = new URL(configuredUrl ?? window.location.origin);

  // In case VITE_SIGNALING_URL was configured as ws/wss.
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

export function websocketUrl(): string {
  const url = new URL(signalingHttpUrl("/ws"));

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
  roomId: string,
  name: string,
): Promise<JoinRoomResult> {
  const response = await fetch(signalingHttpUrl("/room"), {
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

export async function getIceServers(token: string): Promise<RTCIceServer[]> {
  const response = await fetch(signalingHttpUrl("/turn-credentials"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get TURN credentials: ${response.status}`);
  }

  const data = (await response.json()) as { iceServers?: RTCIceServer[] };

  if (!Array.isArray(data.iceServers)) {
    throw new Error("TURN credentials response did not contain iceServers");
  }

  return data.iceServers;
}