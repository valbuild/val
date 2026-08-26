import { cn } from "../designSystem/cn";

/**
 * The Val mark, as drawn on val.build: an upright slab with the brand dot
 * near its foot.
 *
 * The slab takes `currentColor` so it inverts with the theme — light on the
 * dark chrome, dark on the light — while the dot stays the brand green in
 * both. It is a brand mark, not an icon: it does not restyle per surface.
 *
 * The artwork is 19×35, so it is much taller than it is wide. Size it with a
 * square box and it letterboxes to the height, which is what the round
 * launcher and the rail both want.
 */
export function ValLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 19 35"
      fill="none"
      role="img"
      aria-label="Val"
      className={cn("w-full h-full", className)}
    >
      <path
        d="M0.2367 1.019C0.2367 0.7324 0.4691 0.5 0.7557 0.5H18.2748C18.5615 0.5 18.7939 0.7324 18.7939 1.019V33.981C18.7939 34.2676 18.5615 34.5 18.2748 34.5H0.7557C0.4691 34.5 0.2367 34.2676 0.2367 33.981V1.019Z"
        fill="currentColor"
      />
      <ellipse
        cx="9.4504"
        cy="27.2328"
        rx="3.1145"
        ry="3.1145"
        fill="var(--colors-brand-green-400)"
      />
    </svg>
  );
}
