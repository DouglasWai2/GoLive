import type { RoomSessionDeps } from "@golive/core";
import { webAdapter } from "../platform/webAdapter";

export function configuredBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined;

  return configuredUrl ?? window.location.origin;
}

export function createSessionDeps(): RoomSessionDeps {
  return {
    baseUrl: configuredBaseUrl(),
    adapter: webAdapter,
  };
}