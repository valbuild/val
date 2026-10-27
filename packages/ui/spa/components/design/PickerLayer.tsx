import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  attachElementPicker,
  describeElement,
  type PickedElement,
  type PickModifier,
} from "../../design/elementPicker";

/**
 * A page that can be picked from, as Lovable's is: hovering while picking
 * outlines the element under the pointer and names it, a click picks it and
 * keeps it outlined.
 *
 * In the design tab the page is the proposal's, in a frame of another origin,
 * so this runs THERE (through the canvas bridge) and only what was picked
 * crosses over. In a story the page is right here, and this is the whole of
 * it -- the same `elementPicker` either way.
 */
export function PickerLayer({
  children,
  modifier,
  active,
  onPick,
  onStop,
}: {
  children: ReactNode;
  modifier: PickModifier;
  /** Select is on: picking without the modifier. */
  active: boolean;
  onPick: (picked: PickedElement) => void;
  /** Esc while Select is on. */
  onStop?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [picked, setPicked] = useState<Element | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    return attachElementPicker(element, {
      modifier,
      active: () => activeRef.current,
      onHover: setHovered,
      onPick: (target) => {
        setPicked(target);
        onPickRef.current(describeElement(target, element));
      },
    });
  }, [modifier]);

  useEffect(() => {
    if (!active || onStop === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onStop]);

  return (
    <div
      ref={root}
      className="relative h-full overflow-auto"
      style={{ cursor: hovered !== null ? "crosshair" : undefined }}
    >
      {children}
      {picked !== null && picked !== hovered && (
        <Outline root={root.current} element={picked} kind="picked" />
      )}
      {hovered !== null && (
        <Outline root={root.current} element={hovered} kind="hover" />
      )}
    </div>
  );
}

function Outline({
  root,
  element,
  kind,
}: {
  root: HTMLElement | null;
  element: Element;
  kind: "hover" | "picked";
}) {
  const [box, setBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (root === null) return;
    const measure = () => {
      const outer = root.getBoundingClientRect();
      const inner = element.getBoundingClientRect();
      setBox({
        top: inner.top - outer.top + root.scrollTop,
        left: inner.left - outer.left + root.scrollLeft,
        width: inner.width,
        height: inner.height,
      });
    };
    measure();
    root.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      root.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [root, element]);
  if (box === null) return null;
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        outline:
          kind === "hover"
            ? "2px solid var(--bg-proposal)"
            : "2px dashed var(--bg-proposal)",
        outlineOffset: 1,
        background:
          kind === "hover"
            ? "color-mix(in srgb, var(--bg-proposal) 8%, transparent)"
            : undefined,
      }}
    >
      {kind === "hover" && (
        <span
          className="absolute left-0 whitespace-nowrap rounded-sm bg-bg-proposal px-1 py-px font-mono text-[10px] text-fg-on-proposal"
          style={
            box.top >= 18
              ? { bottom: "100%", marginBottom: 2 }
              : { top: "100%", marginTop: 2 }
          }
        >
          {element.tagName.toLowerCase()}
          {element.classList.length > 0 &&
            `.${Array.from(element.classList).slice(0, 2).join(".")}`}
        </span>
      )}
    </div>
  );
}
