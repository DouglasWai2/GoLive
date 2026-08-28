import definition from "./notificationSoundTones.json";

export type NotificationSound = keyof typeof definition.sounds;
export type NotificationTone = readonly [
  frequency: number,
  delay: number,
  duration: number,
  volume: number,
];

export const notificationSoundDefinition = definition as unknown as {
  readonly sampleRate: number;
  readonly gainFloor: number;
  readonly attackDuration: number;
  readonly tailDuration: number;
  readonly sounds: Record<NotificationSound, readonly NotificationTone[]>;
};
