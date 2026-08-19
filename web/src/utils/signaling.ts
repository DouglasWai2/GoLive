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

export async function getIceServers(): Promise<RTCIceServer[]> {
  const response = await fetch(signalingHttpUrl("/turn-credentials"));

  if (!response.ok) {
    throw new Error(`Failed to get TURN credentials: ${response.status}`);
  }

  const data = (await response.json()) as { iceServers?: RTCIceServer[] };

  if (!Array.isArray(data.iceServers)) {
    throw new Error("TURN credentials response did not contain iceServers");
  }

  return data.iceServers;
}