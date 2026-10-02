import type { ReactElement } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

/**
 * The button with its tooltip, as ONE tree whether it is pressable or not.
 *
 * A disabled button fires no pointer events, so the tooltip needs a wrapper to
 * open on -- and it used to get one only while disabled. Toggling `disabled`
 * then swapped the tree around the button, and React unmounted it and mounted
 * a new one: a press that started on the old node and ended on the new one
 * was no click at all. It did nothing and said nothing, and it happened
 * exactly when someone with changes already pending pressed Save just as the
 * last thing they typed reached the server. Now the wrapper is always there
 * and only its attributes change, so the button is the same node throughout.
 */
export function PublishTooltip({
  label,
  description,
  disabled,
  container,
  children,
}: {
  label: string;
  description: string;
  disabled: boolean;
  container: HTMLElement | null;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex"
          {...(disabled
            ? {
                role: "button",
                tabIndex: 0,
                "aria-disabled": true,
                "aria-label": label,
              }
            : {})}
        >
          <span
            className="inline-flex"
            {...(disabled ? { "aria-hidden": true } : {})}
          >
            {children}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent container={container}>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
