import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  id: string;
  label: string;
  children: ReactNode;
}

/**
 * Renders into document.body instead of inline, so it isn't clipped by an
 * ancestor with overflow-x-auto - which (per CSS overflow rules) also clips
 * the y axis, not just x, the moment either axis is non-visible. A table
 * wrapper needs overflow-x-auto for wide tables, so any inline-positioned
 * popover in a table cell gets cut off for rows near the container's edge.
 * Position is computed from the trigger's real screen coordinates and
 * flips above the trigger when there isn't room below the viewport.
 */
export function Popover({ open, onClose, anchorRef, id, label, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popoverWidth = popoverRef.current?.offsetWidth ?? 0;
    const popoverHeight = popoverRef.current?.offsetHeight ?? 0;
    const gap = 6;
    const margin = 8;
    const fitsBelow = anchorRect.bottom + gap + popoverHeight <= window.innerHeight;
    const left = Math.min(anchorRect.left, window.innerWidth - popoverWidth - margin);

    setStyle({
      left: Math.max(margin, left),
      top: fitsBelow ? anchorRect.bottom + gap : anchorRect.top - gap - popoverHeight,
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      role="dialog"
      aria-label={label}
      // Invisible until positioned, so it doesn't flash at (0,0) on the first paint.
      style={{ position: "fixed", top: style?.top ?? 0, left: style?.left ?? 0, visibility: style ? "visible" : "hidden" }}
      className="z-50 w-[20rem] max-w-[90vw] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}
