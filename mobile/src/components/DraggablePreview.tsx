import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ReactNode } from "react";
import { clampPreviewPosition, type PreviewPosition, type PreviewSize } from "../utils/previewPosition";

type DraggablePreviewProps = {
  stageSize: PreviewSize;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
  draggable?: boolean;
};

const INITIAL_POSITION: PreviewPosition = { x: 0, y: 0 };

export function DraggablePreview({ stageSize, style, children, draggable = true }: DraggablePreviewProps) {
  const [position, setPosition] = useState(INITIAL_POSITION);
  const [previewSize, setPreviewSize] = useState<PreviewSize>({ width: 0, height: 0 });
  const positionRef = useRef(position);
  const previewSizeRef = useRef(previewSize);
  const dragOriginRef = useRef(INITIAL_POSITION);
  const draggableRef = useRef(draggable);

  positionRef.current = position;
  draggableRef.current = draggable;

  const setBoundedPosition = (nextPosition: PreviewPosition) => {
    const bounded = clampPreviewPosition(nextPosition, stageSize, previewSizeRef.current);
    positionRef.current = bounded;
    setPosition(bounded);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      draggable && Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 6,
    onMoveShouldSetPanResponder: (_, gesture) =>
      draggable && Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 6,
    onPanResponderGrant: () => {
      dragOriginRef.current = positionRef.current;
    },
    onPanResponderMove: (_, gesture) => {
      setBoundedPosition({
        x: dragOriginRef.current.x + gesture.dx,
        y: dragOriginRef.current.y + gesture.dy,
      });
    },
    onPanResponderTerminationRequest: () => false,
  }), [draggable, stageSize]);

  useEffect(() => {
    if (!draggableRef.current) return;
    setBoundedPosition(positionRef.current);
  }, [stageSize, previewSize]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const nextSize = { width, height };
    previewSizeRef.current = nextSize;
    setPreviewSize((current) => current.width === width && current.height === height ? current : nextSize);
  };

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        style,
        draggable ? { transform: [{ translateX: position.x }, { translateY: position.y }] } : null,
      ]}
      onLayout={handleLayout}
    >
      {children}
    </View>
  );
}
