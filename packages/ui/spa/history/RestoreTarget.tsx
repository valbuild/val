import {
  explainIncompatible,
  type Compatibility,
} from "@valbuild/shared/internal";
import { Check, CircleHelp, Lock } from "lucide-react";
import { useState } from "react";
import { cn } from "../components/designSystem/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";

/**
 * A field on the "now" side, while a restore is being aimed at it.
 *
 * Two jobs, and the second is the one that matters. It marks the field with
 * whether the value being restored can live here — BEFORE anyone clicks, so the
 * answer is something you read rather than something you find out. And when a
 * field cannot take the value, clicking it explains why instead of doing
 * nothing: a control that silently ignores a click reads as broken, and the
 * reason a restore is refused is the most useful thing we know.
 *
 * `unknown` is offered, not refused. It is the honest answer for a value we
 * cannot fully compare (rich text, today) and refusing those would block
 * restores that are almost always fine — so it is allowed, and labelled.
 */
export function RestoreTarget({
  compatibility,
  selected,
  onSelect,
  children,
}: {
  compatibility: Compatibility;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const [explaining, setExplaining] = useState(false);
  const refused = compatibility.status === "incompatible";
  return (
    <Popover open={explaining} onOpenChange={setExplaining}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          // NOT aria-disabled, deliberately. A refused field still responds —
          // clicking it is how you find out why — and `aria-disabled` promises
          // the opposite. The refusal is carried by the badge's own words,
          // which a screen reader reads out with the field.
          data-restore-status={compatibility.status}
          onClick={() => (refused ? setExplaining(true) : onSelect())}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              if (refused) setExplaining(true);
              else onSelect();
            }
          }}
          className={cn(
            "relative rounded-lg border p-3 transition-colors",
            refused
              ? "cursor-not-allowed border-dashed border-border-primary opacity-60"
              : "cursor-pointer border-border-primary hover:border-fg-brand-primary",
            selected && "border-fg-brand-primary ring-1 ring-fg-brand-primary",
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <RestoreBadge compatibility={compatibility} selected={selected} />
          </div>
          {children}
        </div>
      </PopoverTrigger>
      {refused && (
        <PopoverContent align="start" className="w-80">
          <div className="text-sm font-semibold text-fg-primary">
            This cannot be restored here
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            {explainIncompatible(compatibility.reason)}
          </p>
          <p className="mt-2 text-xs text-fg-tertiary">
            Pick a field that can hold this value, or change the schema first.
          </p>
        </PopoverContent>
      )}
    </Popover>
  );
}

/** The mark itself, so the same wording is used wherever a status is shown. */
export function RestoreBadge({
  compatibility,
  selected,
}: {
  compatibility: Compatibility;
  selected?: boolean;
}) {
  if (selected) {
    return (
      <Mark className="border-fg-brand-primary text-fg-brand-primary">
        <Check size={12} /> Restoring here
      </Mark>
    );
  }
  if (compatibility.status === "incompatible") {
    return (
      <Mark className="border-border-primary text-fg-tertiary">
        <Lock size={12} /> Cannot restore
      </Mark>
    );
  }
  if (compatibility.status === "unknown") {
    return (
      <Mark className="border-border-primary text-fg-secondary">
        <CircleHelp size={12} /> Probably fits
      </Mark>
    );
  }
  return (
    <Mark className="border-fg-brand-primary text-fg-brand-primary">
      Can restore here
    </Mark>
  );
}

function Mark({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        className,
      )}
    >
      {children}
    </span>
  );
}
