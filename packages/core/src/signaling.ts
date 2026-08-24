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
    roomInstanceId: string;
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
  const response = await fetch(signalingHttpUrl(baseUrl, "/session"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(await errorFrom(response));
  }

  const data = (await response.json()) as { iceServers?: IceServer[] };

  if (
    !Array.isArray(data.iceServers)
    || !data.iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => /^turns?:/i.test(url))
        && typeof server.username === "string"
        && typeof server.credential === "string";
    })
  ) {
    throw new Error("TURN credentials response did not contain a relay server");
  }

  return data.iceServers;
}

async function errorFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) {
      return body.error;
    }
  } catch {
    /* Fall through to the status-based message. */
  }

  return `Request failed: ${response.status}`;
}

export async function createInvite(
  baseUrl: string,
  roomId: string,
  token: string,
): Promise<string> {
  const response = await fetch(signalingHttpUrl(baseUrl, "/invite"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ roomId }),
  });

  if (!response.ok) {
    throw new Error(await errorFrom(response));
  }

  const data = (await response.json()) as { inviteToken?: string };

  if (typeof data.inviteToken !== "string") {
    throw new Error("Invite response did not contain an inviteToken");
  }

  return data.inviteToken;
}

export async function verifyInvite(
  baseUrl: string,
  roomId: string,
  name: string,
  inviteToken: string,
): Promise<JoinRoomResult> {
  const response = await fetch(signalingHttpUrl(baseUrl, "/invite/verify"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomId, name, inviteToken }),
  });

  if (!response.ok) {
    throw new Error(await errorFrom(response));
  }

  return (await response.json()) as JoinRoomResult;
}

export function buildInviteUrl(
  webOrigin: string,
  roomId: string,
  inviteToken: string,
): string {
  return `${webOrigin.replace(/\/+$/, "")}/room/${roomId}?token=${encodeURIComponent(inviteToken)}`;
}

export type InviteLink = {
  roomId: string;
  inviteToken: string;
};

export function parseInviteUrl(url: string): InviteLink | null {
  const roomMatch = url.match(
    /(?:\/room\/)([a-zA-Z0-9_-]{8,64})(?:\?(?:[^#]*?&)?token=([^&#\s]+))?/,
  );
  const roomId = roomMatch?.[1] ?? null;
  const inviteToken = roomMatch?.[2] ?? null;

  if (!roomId || !inviteToken) {
    return null;
  }

  return { roomId, inviteToken: decodeURIComponent(inviteToken) };
}
