import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  ink: "#11110f",
  room: "#10100e",
  paper: "#f1f0e8",
  muted: "#98988f",
  dim: "#6f6f68",
  line: "#30302b",
  lineStrong: "#41413b",
  surface: "#171715",
  surfaceRaised: "#1b1b18",
  surfaceControl: "#22221e",
  acid: "#c9ff42",
  acidInk: "#15160f",
  red: "#ff5d4a",
  redText: "#ffb0a7",
  video: "#080808",
  black: "#000000",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  control: 4,
  overlay: 6,
  sheet: 8,
  round: 999,
} as const;

export const technicalText: TextStyle = {
  fontFamily: "monospace",
  textTransform: "uppercase",
  letterSpacing: 1.1,
};

export const raisedSurface: ViewStyle = {
  shadowColor: colors.black,
  shadowOffset: { width: 0, height: 18 },
  shadowOpacity: 0.32,
  shadowRadius: 28,
  elevation: 12,
};

export const controlShadow: ViewStyle = {
  shadowColor: colors.black,
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.28,
  shadowRadius: 18,
  elevation: 8,
};
