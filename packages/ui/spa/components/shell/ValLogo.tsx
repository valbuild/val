import { cn } from "../designSystem/cn";
import { usePrefersReducedMotion } from "./canvas/usePrefersReducedMotion";

/**
 * The Val mark: a terminal caret over the brand dot, in a standing frame.
 *
 * Three ideas in one silhouette, and each of them is load-bearing:
 *
 * - **The frame** is the shape val.build already used — a slab taller than it
 *   is wide — so the mark stays recognisable as Val's. It is now an outline
 *   rather than a solid, because the frame is the container for the other two
 *   and a solid one leaves nowhere to put them.
 * - **The caret** is a terminal's block cursor. Val is content as code: the
 *   content lives in `.val.ts` files a developer edits, and the caret is the
 *   most compact way to say "this is a thing you type into" without a single
 *   glyph of text.
 * - **The dot** is the brand dot, kept from the old mark and moved under the
 *   caret so the pair reads as a prompt.
 *
 * And the frame with one lit element in it is deliberately HAL's portrait —
 * inverted. HAL is a black slab with a red eye that watches you and decides
 * what you may do; this is a light frame with a green caret that waits for you
 * to tell it what to do. The joke only lands if the light is green, which is
 * the other reason for the rule below.
 *
 * **Always green, in both themes.** The mark does not take `currentColor` and
 * does not invert. `--colors-brand-green-400` is a fixed brand value, declared
 * once outside the light/dark blocks, so this is the same green on the dark
 * chrome and on the light. The old mark drew its slab in `currentColor`, which
 * made the mark a different colour on every surface it appeared on.
 *
 * The artwork is 19x35 — much taller than wide — so a square box letterboxes to
 * the height, which is what the rail and the round launcher both want.
 */
export function ValLogo({
  className,
  /**
   * Blink the caret, as a terminal does while it waits.
   *
   * For loading, and only for loading: a mark that always blinks is a mark that
   * is always demanding attention. Honours `prefers-reduced-motion` — a
   * blinking element is one of the few things that specifically hurts people
   * who ask for less motion.
   */
  blinking,
}: {
  className?: string;
  blinking?: boolean;
}) {
  // Checked here rather than by every caller: a caller that forgets is a caller
  // that blinks at someone who asked it not to.
  const reducedMotion = usePrefersReducedMotion();
  const blink = blinking && !reducedMotion;
  return (
    <svg
      viewBox="0 0 19 35"
      fill="none"
      role="img"
      aria-label="Val"
      className={cn("w-full h-full", className)}
    >
      {/* The standing frame. Inset by half the stroke so the outline sits
          inside the viewBox rather than being clipped by it. */}
      <rect
        x="1.25"
        y="1.25"
        width="16.5"
        height="32.5"
        rx="1.5"
        stroke={BRAND_GREEN}
        strokeWidth="2.5"
      />
      {/* The block caret, at the height a cursor sits on a line of text. */}
      <rect
        x="6.35"
        y="9.5"
        width="6.3"
        height="10.5"
        rx="0.6"
        fill={BRAND_GREEN}
      >
        {blink && (
          /*
           * `discrete` on purpose: a terminal cursor is on or off, never
           * halfway. In SMIL rather than CSS because this is drawn inside a
           * shadow root and shipped as one file — a keyframe animation would
           * have to be declared in the SPA's stylesheet and could not travel
           * with the component.
           */
          <animate
            attributeName="opacity"
            values="1;1;0;0"
            dur="1.06s"
            calcMode="discrete"
            repeatCount="indefinite"
          />
        )}
      </rect>
      {/* The brand dot, under the caret: together they read as a prompt. */}
      <circle cx="9.5" cy="26.5" r="3.1" fill={BRAND_GREEN} />
    </svg>
  );
}

/**
 * The one colour in the mark.
 *
 * A brand value rather than a theme token: theme tokens are the point at which
 * light and dark diverge, and this must not.
 */
const BRAND_GREEN = "var(--colors-brand-green-400)";
