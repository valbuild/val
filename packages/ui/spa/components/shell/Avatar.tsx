import { cn } from "../designSystem/cn";

/**
 * Initials avatar. Deliberately not an image: the shell should not depend on
 * a network round-trip to render its own chrome.
 */
export function Avatar({
  initials,
  size = "md",
  className,
}: {
  initials: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid place-items-center rounded-full bg-bg-float-raised text-fg-primary border border-border-float font-medium select-none",
        size === "sm" ? "w-7 h-7 text-[0.625rem]" : "w-8 h-8 text-[0.6875rem]",
        className,
      )}
    >
      {initials}
    </span>
  );
}
