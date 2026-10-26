import type { ReactNode } from "react";
import { cn } from "../designSystem/cn";

/*
 * The pieces the phone's bottom sheets are made of: the location sheet behind
 * the top bar's chip, the changes sheet behind the primary button's caret and
 * the activity sheet behind the bell. Above a phone the same acts are menus
 * and panels with denser rows, pointed at rather than pressed with a thumb.
 */

/**
 * A sheet's heading when its subject has a name: what kind of thing it is, the
 * name itself -- wrapping, never truncated, because this is the one place it
 * is spelled out -- and a line about it.
 */
export function SheetHeading({
  kicker,
  title,
  detail,
  proposal = false,
}: {
  kicker: ReactNode;
  title: string;
  detail?: string;
  proposal?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "mb-1 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider",
          proposal ? "text-fg-proposal" : "text-fg-secondary-alt",
        )}
      >
        {kicker}
      </div>
      <div className="break-words text-base font-semibold leading-snug text-fg-primary">
        {title}
      </div>
      {detail !== undefined && (
        <div className="mt-1 text-xs text-fg-secondary">{detail}</div>
      )}
    </>
  );
}

/**
 * A row in a phone sheet: a whole-width button, 44px tall at least, because
 * it is pressed with a thumb rather than pointed at.
 */
export function SheetRow({
  icon,
  onClick,
  detail,
  trailing,
  destructive = false,
  disabled = false,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  detail?: string;
  trailing?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-bg-float-raised disabled:hover:bg-transparent",
        destructive
          ? "text-fg-error-on-surface"
          : disabled
            ? "text-fg-disabled"
            : "text-fg-primary",
      )}
    >
      <span className="grid w-5 shrink-0 place-items-center text-fg-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {detail !== undefined && (
          <span className="block text-xs text-fg-secondary">{detail}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
          {trailing}
        </span>
      )}
    </button>
  );
}
