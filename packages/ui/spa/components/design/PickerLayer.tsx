import { useEffect, useRef, type ReactNode } from "react";
import {
  startElementPicking,
  type ElementPicking,
  type PickedElement,
  type PickModifier,
} from "@valbuild/shared/internal";

/**
 * A page of the stories' own that can be picked from, with the picker the
 * proposal's page runs (`startElementPicking`, which the canvas bridge mounts
 * there). In the design tab the page is in a frame of another origin, so the
 * bridge runs it and only what was picked crosses over; here the page is right
 * here, and this stands in for the bridge.
 */
export function PickerLayer({
  children,
  modifier,
  active,
  keepPicked,
  onPick,
  onStop,
}: {
  children: ReactNode;
  modifier: PickModifier;
  /** Select is on: picking without the modifier. */
  active: boolean;
  /** Whether the pick is still held: false takes its outline down. */
  keepPicked: boolean;
  onPick: (picked: PickedElement) => void;
  /** Esc while Select is on. */
  onStop: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const picker = useRef<ElementPicking | null>(null);
  const latest = useRef({ active, onPick, onStop });
  useEffect(() => {
    latest.current = { active, onPick, onStop };
  });

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const started = startElementPicking(element, {
      modifier,
      active: () => latest.current.active,
      color: "#7c3aed",
      onPick: (picked) => latest.current.onPick(picked),
      onStop: () => latest.current.onStop(),
    });
    picker.current = started;
    return () => {
      picker.current = null;
      started.stop();
    };
  }, [modifier]);

  useEffect(() => {
    if (!keepPicked) picker.current?.clearPicked();
  }, [keepPicked]);

  return (
    <div ref={root} className="h-full overflow-auto">
      {children}
    </div>
  );
}
