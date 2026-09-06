import { explainIncompatible } from "@valbuild/shared/internal";
import { Check, CircleHelp, Lock } from "lucide-react";
import { useState } from "react";
import { cn } from "../components/designSystem/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
import type { FieldRestoreRole } from "./RestoreModeContext";

/**
 * The restore affordance around a field, or nothing at all.
 *
 * Wraps rather than replaces: when no restore is being aimed this renders its
 * children and adds not one element, so a field in the ordinary Studio is
 * untouched by this feature existing.
 *
 * On the commit side every field is offered — a value at a commit is always a
 * legal value of the schema it was stored under. On the "now" side each field
 * says whether it can hold what was picked, BEFORE anyone clicks, and a field
 * that cannot explains why when clicked instead of ignoring the click. A
 * control that silently does nothing reads as broken, and the reason a restore
 * is refused is the most useful thing we know.
 */
export function RestoreChrome({
  restore,
  children,
}: {
  restore: { role: FieldRestoreRole; onPick: () => void } | null;
  children: React.ReactNode;
}) {
  const [explaining, setExplaining] = useState(false);
  if (!restore) {
    return <>{children}</>;
  }
  const { role, onPick } = restore;
  const refused =
    role.role === "target" && role.compatibility.status === "incompatible";
  return (
    <Popover open={explaining} onOpenChange={setExplaining}>
      <PopoverTrigger asChild>
        <div
          data-restore-role={role.role}
          data-restore-status={
            role.role === "target" ? role.compatibility.status : "source"
          }
          className={cn(
            "relative rounded-lg border-2 border-dashed p-1 transition-colors",
            refused
              ? "cursor-not-allowed border-border-primary opacity-60"
              : "cursor-pointer border-transparent hover:border-fg-brand-primary",
            role.picked && "border-solid border-fg-brand-primary",
          )}
          onClick={(ev) => {
            // The field's own controls stay usable on the "now" side, which is
            // still the live editor: only a click on the chrome itself picks.
            if (ev.target !== ev.currentTarget) return;
            if (refused) setExplaining(true);
            else onPick();
          }}
        >
          <div className="pointer-events-none absolute -top-2 left-3 z-10">
            <RestoreBadge role={role} />
          </div>
          {/*
           * A click anywhere inside also picks, on the READ-ONLY commit pane
           * where there is nothing else a click could mean. On the live side
           * the badge above is the target, so typing in a field does not
           * restore anything.
           */}
          {role.role === "source" ? (
            <div onClick={onPick}>{children}</div>
          ) : (
            children
          )}
        </div>
      </PopoverTrigger>
      {refused && role.role === "target" && (
        <PopoverContent align="start" className="w-80">
          <div className="text-sm font-semibold text-fg-primary">
            This cannot be restored here
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            {role.compatibility.status === "incompatible"
              ? explainIncompatible(role.compatibility.reason)
              : null}
          </p>
          <p className="mt-2 text-xs text-fg-tertiary">
            Pick a field that can hold this value, or change the schema first.
          </p>
        </PopoverContent>
      )}
    </Popover>
  );
}

function RestoreBadge({ role }: { role: FieldRestoreRole }) {
  if (role.role === "source") {
    return (
      <Mark className="border-fg-brand-primary bg-bg-primary text-fg-brand-primary">
        {role.picked ? (
          <>
            <Check size={12} /> Restoring this
          </>
        ) : (
          "Restore this"
        )}
      </Mark>
    );
  }
  if (role.picked) {
    return (
      <Mark className="border-fg-brand-primary bg-bg-primary text-fg-brand-primary">
        <Check size={12} /> Restoring here
      </Mark>
    );
  }
  if (role.compatibility.status === "incompatible") {
    return (
      <Mark className="border-border-primary bg-bg-primary text-fg-tertiary">
        <Lock size={12} /> Cannot restore
      </Mark>
    );
  }
  if (role.compatibility.status === "unknown") {
    return (
      <Mark className="border-border-primary bg-bg-primary text-fg-secondary">
        <CircleHelp size={12} /> Probably fits
      </Mark>
    );
  }
  return (
    <Mark className="border-fg-brand-primary bg-bg-primary text-fg-brand-primary">
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
