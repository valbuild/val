import { cn } from "../designSystem/cn";

/**
 * The Val mark: a stencilled V. Small enough to sit in the rail at 28px and
 * still read in the mobile top bar.
 */
export function ValLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("w-full h-full", className)}
    >
      <path
        d="M5 6.5h3.6l3.4 9.1 3.4-9.1H19l-5.4 13.2h-3.2L5 6.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
