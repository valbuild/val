import { Earth } from "lucide-react";
import { cn } from "../designSystem/cn";
import { ExternalModule } from "./types";

export type ExternalButtonProps = {
  /** External module data */
  external: ExternalModule;
  /** Whether this button is active (currently viewing external) */
  isActive?: boolean;
  /** Called when the button is clicked */
  onClick?: () => void;
};

export function ExternalButton({
  isActive = false,
  onClick,
}: ExternalButtonProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-2 w-full h-12 px-4 border-t border-border-primary shrink-0",
        "text-sm font-medium uppercase tracking-wide text-fg-secondary",
        "hover:bg-bg-secondary transition-colors",
        {
          "bg-bg-secondary text-fg-primary": isActive,
        },
      )}
      onClick={onClick}
    >
      <Earth size={16} />
      <span>External</span>
    </button>
  );
}
