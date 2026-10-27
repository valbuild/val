import { cn } from "../designSystem/cn";
import { usePrefersReducedMotion } from "./canvas/usePrefersReducedMotion";

/**
 * The Val mark: a green slab with the brand dot punched out of it.
 *
 * The artwork val.build uses, drawn to match. Two things about it are easy to
 * get wrong and both are load-bearing:
 *
 * **The dot is a hole, not a circle.** It is knocked out of the slab with a
 * mask, so whatever is behind the mark shows through it — dark on the dark
 * chrome, light on the light. Painting a dark circle instead looks identical on
 * one surface and wrong on every other, which is exactly the bug the previous
 * version had in reverse.
 *
 * **The blur is part of it.** A green glow around the slab (`feGaussianBlur` on
 * the shape, tinted and composited outside it) and a softer one inside the
 * hole's edge. Without them the mark reads as a flat sticker; the original is
 * lit.
 *
 * Always this green, in both themes: `--brand-val-green` is declared once,
 * outside the light/dark blocks. The mark it replaced took `currentColor`,
 * which made the logo a different colour on every surface.
 *
 * That token exists so this stays true when a project sets `theme.accent`,
 * which regenerates the whole `--colors-brand-green-*` ramp. The mark used to
 * name a step of that ramp, so it recoloured with the chrome — which was an
 * accident, not the rule in architecture/logo.md.
 *
 * The artwork is 105x149 — much taller than wide — so a square box letterboxes
 * it to the height, which is what the rail and the round launcher both want.
 */
export function ValLogo({
  className,
  /**
   * Blink the dot, as a terminal cursor does while it waits.
   *
   * For loading, and only for loading. Honours `prefers-reduced-motion`: a
   * blinking element is one of the few things that specifically hurts people who
   * ask for less motion.
   */
  blinking,
}: {
  className?: string;
  blinking?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const blink = blinking && !reducedMotion;
  return (
    <svg
      viewBox="0 0 105 149"
      fill="none"
      role="img"
      aria-label="Val"
      className={cn("w-full h-full", className)}
    >
      <defs>
        {/*
         * The hole. White keeps the slab, black cuts it away — so the dot is an
         * absence and the page behind it is what you see.
         */}
        <mask id="val-mark-hole">
          <rect x="0" y="0" width="105" height="149" fill="white" />
          <circle cx="49.9" cy="104.2" r="9.61" fill="black">
            {/* Blinking closes the hole rather than recolouring it — there is no
                colour to change. `discrete` because a cursor is on or off. */}
            {blink && (
              <animate
                attributeName="fill"
                values="black;black;white;white"
                dur="1.06s"
                calcMode="discrete"
                repeatCount="indefinite"
              />
            )}
          </circle>
        </mask>
        {/* The glow around the slab. Green at 30%, blurred and kept outside the
            shape itself, which is what makes it read as light rather than as a
            thicker edge. */}
        <filter
          id="val-mark-glow"
          x="0"
          y="0"
          width="105"
          height="149"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feGaussianBlur stdDeviation="10.72" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.219608 0 0 0 0 0.803922 0 0 0 0 0.501961 0 0 0 0.3 0"
          />
          <feBlend mode="normal" in2="SourceGraphic" />
        </filter>
        {/* And a softer one just inside the hole's edge, so the cut-out has
            depth instead of looking stamped. */}
        <filter
          id="val-mark-hole-shadow"
          x="35"
          y="90"
          width="30"
          height="30"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <g filter="url(#val-mark-glow)">
        <path
          d="M21.4768 23.3474C21.4768 22.4628 22.1939 21.7457 23.0785 21.7457H77.1357C78.0203 21.7457 78.7374 22.4628 78.7374 23.3474V125.055C78.7374 125.94 78.0203 126.657 77.1357 126.657H23.0785C22.1939 126.657 21.4768 125.94 21.4768 125.055V23.3474Z"
          fill={BRAND_GREEN}
          mask="url(#val-mark-hole)"
        />
      </g>
      {/* The hole's inner shadow, drawn as a blurred ring just inside its
          edge. Clipped to the hole by the same circle, at low opacity. */}
      <circle
        cx="49.9"
        cy="104.2"
        r="9.61"
        fill="none"
        stroke={BRAND_GREEN}
        strokeWidth="3"
        strokeOpacity="0.3"
        filter="url(#val-mark-hole-shadow)"
      />
    </svg>
  );
}

/**
 * The one colour in the mark.
 *
 * A brand value rather than a theme token, in both senses of "theme": theme
 * tokens are the point at which light and dark diverge, and the brand ramp is
 * what a project's own accent replaces. This must not follow either.
 */
const BRAND_GREEN = "var(--brand-val-green)";

/**
 * The project's own mark where Val's would be, or Val's when it has none.
 *
 * One component for the two slots that show a mark in the Studio — the top of
 * the left rail, and beside the menu button on mobile — so that "which mark,
 * and how is it sized" is answered once.
 *
 * `object-contain`, and that is the decision worth knowing about. The slot is
 * 32px wide, so it is a slot for a MARK: a wide wordmark put in it is contained
 * rather than cropped, which makes it small but keeps all of it. Cropping would
 * be worse in the way that matters — a logo with its ends cut off looks like a
 * bug in Val rather than a picture that does not fit.
 *
 * The blink belongs to the Val mark alone. It is a terminal cursor waiting, and
 * an `<img>` cannot do it; a project with a logo therefore shows Val's mark
 * blinking while the Studio loads and its own once the settings arrive, which
 * is the same "the theme turns up with the content" the accent has.
 */
export function StudioMark({
  logo,
  className,
  blinking,
}: {
  /** From `s.settings()`'s `theme.logo`, already resolved. See `ShellLogo`. */
  logo?: { url: string; alt?: string };
  className?: string;
  blinking?: boolean;
}) {
  if (logo) {
    return (
      <img
        src={logo.url}
        // Empty rather than absent when there is no name for it: an unnamed
        // image inside a navigation landmark is announced as an image with a
        // URL for a name, and a decorative one is better skipped.
        alt={logo.alt ?? ""}
        className={cn("w-full h-full object-contain", className)}
      />
    );
  }
  return <ValLogo className={className} blinking={blinking} />;
}
