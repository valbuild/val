import { ReactNode, useEffect, useRef } from "react";

/**
 * A field you can look at but not change.
 *
 * Seven fields each had their own copy of `pointer-events-none opacity-70`,
 * which is half a guard: it stops the mouse and nothing else. Tab still reached
 * the input, typing still fired `onChange`, and the patch was written — so
 * `s.string().readonly()` was a field that looked read-only and was not.
 *
 * `inert` is the part that was missing. It takes the whole subtree out of the
 * tab order, blocks every event, and hides it from assistive technology, which
 * is exactly the set of things "readonly" is claiming. Set through a ref rather
 * than as a JSX attribute because React 18 does not forward `inert` to the DOM;
 * the class is kept for the mouse cursor and the dimming, which `inert` does not
 * do on its own.
 *
 * Not `disabled` on each control: that is a per-control prop with per-control
 * spelling — `readOnly` on an input, `disabled` on a button, neither on a
 * `contenteditable` — and seven fields getting it right individually is seven
 * chances to miss one.
 */
export function ReadonlyGuard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.inert = true;
    return () => {
      node.inert = false;
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-disabled="true"
      className="pointer-events-none opacity-70"
    >
      {children}
    </div>
  );
}
