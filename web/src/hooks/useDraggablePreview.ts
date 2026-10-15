import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export type PreviewCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNERS: PreviewCorner[] = ["top-left", "top-right", "bottom-right", "bottom-left"];

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

function positionLabel(corner: PreviewCorner) {
  return corner.replace("-", " ");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function useDraggablePreview() {
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [corner, setCorner] = useState<PreviewCorner>("bottom-right");
  const [isDragging, setIsDragging] = useState(false);
  const [positionAnnouncement, setPositionAnnouncement] = useState("");

  const setPosition = (next: PreviewCorner) => {
    setCorner(next);
    setPositionAnnouncement(`Preview moved to ${positionLabel(next)}.`);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a, [data-preview-no-drag]")) return;
    const preview = previewRef.current;
    const container = preview?.parentElement;
    if (!preview || !container) return;

    const inset = Number.parseFloat(getComputedStyle(container).getPropertyValue("--preview-inset")) || 8;
    const maxLeft = Math.max(inset, container.clientWidth - preview.offsetWidth - inset);
    const maxTop = Math.max(inset, container.clientHeight - preview.offsetHeight - inset);
    const left = clamp(preview.offsetLeft, Math.min(inset, maxLeft), maxLeft);
    const top = clamp(preview.offsetTop, Math.min(inset, maxTop), maxTop);

    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.right = "auto";
    preview.style.bottom = "auto";
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: left,
      startTop: top,
      moved: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const preview = previewRef.current;
    const container = preview?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !preview || !container) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 5) drag.moved = true;

    const inset = Number.parseFloat(getComputedStyle(container).getPropertyValue("--preview-inset")) || 8;
    const maxLeft = Math.max(inset, container.clientWidth - preview.offsetWidth - inset);
    const maxTop = Math.max(inset, container.clientHeight - preview.offsetHeight - inset);
    preview.style.left = `${clamp(drag.startLeft + deltaX, Math.min(inset, maxLeft), maxLeft)}px`;
    preview.style.top = `${clamp(drag.startTop + deltaY, Math.min(inset, maxTop), maxTop)}px`;
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const preview = previewRef.current;
    const container = preview?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !preview || !container) return;

    if (drag.moved) {
      const inset = Number.parseFloat(getComputedStyle(container).getPropertyValue("--preview-inset")) || 8;
      const maxLeft = Math.max(inset, container.clientWidth - preview.offsetWidth - inset);
      const maxTop = Math.max(inset, container.clientHeight - preview.offsetHeight - inset);
      const left = clamp(preview.offsetLeft, Math.min(inset, maxLeft), maxLeft);
      const top = clamp(preview.offsetTop, Math.min(inset, maxTop), maxTop);
      const corners: Array<{ corner: PreviewCorner; left: number; top: number }> = [
        { corner: "top-left", left: Math.min(inset, maxLeft), top: Math.min(inset, maxTop) },
        { corner: "top-right", left: maxLeft, top: Math.min(inset, maxTop) },
        { corner: "bottom-right", left: maxLeft, top: maxTop },
        { corner: "bottom-left", left: Math.min(inset, maxLeft), top: maxTop },
      ];
      const nearestCorner = corners.reduce((nearest, candidate) => {
        const distance = Math.hypot(left - candidate.left, top - candidate.top);
        const nearestDistance = Math.hypot(left - nearest.left, top - nearest.top);
        return distance < nearestDistance ? candidate : nearest;
      });
      setPosition(nearestCorner.corner);
      suppressClickRef.current = event.type === "pointerup";
    }

    preview.style.removeProperty("left");
    preview.style.removeProperty("top");
    preview.style.removeProperty("right");
    preview.style.removeProperty("bottom");
    dragRef.current = null;
    setIsDragging(false);
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a, [data-preview-no-drag]")) return;
    const next = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
    setPosition(next);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    let next = corner;
    if (event.key === "ArrowLeft") next = corner.endsWith("left") ? corner : corner.startsWith("top") ? "top-left" : "bottom-left";
    else if (event.key === "ArrowRight") next = corner.endsWith("right") ? corner : corner.startsWith("top") ? "top-right" : "bottom-right";
    else if (event.key === "ArrowUp") next = corner.startsWith("top") ? corner : corner.endsWith("left") ? "top-left" : "top-right";
    else if (event.key === "ArrowDown") next = corner.startsWith("bottom") ? corner : corner.endsWith("left") ? "bottom-left" : "bottom-right";
    else return;

    event.preventDefault();
    if (next !== corner) setPosition(next);
  };

  return {
    previewRef,
    corner,
    isDragging,
    positionAnnouncement,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onClick,
    onKeyDown,
  };
}
