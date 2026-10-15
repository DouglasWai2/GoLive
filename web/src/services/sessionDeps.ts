import type { RoomSessionDeps } from "@golive/core";
import { webAdapter } from "../platform/webAdapter";

export function configuredBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined;

  return configuredUrl ?? window.location.origin;
}

export function createSessionDeps(onMicrophoneStream?: (stream: MediaStream) => void): RoomSessionDeps {
  return {
    baseUrl: configuredBaseUrl(),
    adapter: onMicrophoneStream
      ? {
          ...webAdapter,
          getUserMedia: async (constraints) => {
            const stream = await webAdapter.getUserMedia!(constraints);
            onMicrophoneStream(stream as unknown as MediaStream);
            return stream;
          },
        }
      : webAdapter,
  };
}
