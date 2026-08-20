/*
 * Signaling endpoint for this device.
 *
 * Override at build/start time with EXPO_PUBLIC_SIGNALING_URL, e.g. the host
 * machine's LAN IP for a physical device:
 *
 *   EXPO_PUBLIC_SIGNALING_URL=http://192.168.1.20:3000 npm run start -w mobile
 *
 * Defaults to the Android emulator alias for the host's localhost.
 */
export const SIGNALING_URL =
  process.env.EXPO_PUBLIC_SIGNALING_URL ?? "http://10.0.2.2:3000";