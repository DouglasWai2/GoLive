import Svg, { Circle, Path, Rect } from "react-native-svg";

type IconProps = {
  size?: number;
  color?: string;
};

const common = (size: number, color: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const,
});

export function ScreenIcon({ size = 20, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Rect x="3" y="4" width="18" height="13" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="M8 21h8M12 17v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function ShareIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M12 16V4M8 8l4-4 4 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function UsersIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Circle cx="9" cy="8" r="3" stroke={color} strokeWidth="1.8" />
      <Path d="M3.5 19v-1a5.5 5.5 0 0 1 11 0v1M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V19" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function FullscreenIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function FullscreenExitIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function VolumeIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M4 9v6h4l5 4V5L8 9H4z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <Path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function VolumeMutedIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M4 9v6h4l5 4V5L8 9H4z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <Path d="M16 9l5 6M21 9l-5 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function StatsIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M4 20v-6M10 20V8M16 20V9M21 20H3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function BackIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M19 12H5M11 18l-6-6 6-6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M5 5l14 14M19 5L5 19" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function MicrophoneIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function MicrophoneMutedIcon({ size = 18, color = "currentColor" }: IconProps) {
  return (
    <Svg {...common(size, color)}>
      <Path d="M9 8V6a3 3 0 0 1 5.8-1M15 10v1a3 3 0 0 1-4.5 2.6M5.5 11a6.5 6.5 0 0 0 10.8 4.9M12 17.5V21M8.5 21h7M4 4l16 16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}
