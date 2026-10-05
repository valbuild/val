import { cn } from "../designSystem/cn";

/**
 * Where a value shown in a field picked from a gallery comes from.
 *
 * - `own`: the field's, and nothing to say — either it is not picked from a
 *   gallery, or the gallery has nothing here to fall back to.
 * - `inherited`: the gallery's default, shown and not editable here — what the
 *   page gets until the field sets its own.
 * - `overridden`: the field's own, over a default the gallery also has.
 */
export type Inheritance = "own" | "inherited" | "overridden";

/**
 * "From gallery · Override" / "Overridden · Use gallery's".
 *
 * Said per value, beside it, because a field overrides its gallery KEY BY KEY
 * (`fillFromGallery`): a field can have its own start and the gallery's end,
 * and a single switch for the whole field would say neither.
 */
export function InheritedNote({
  inheritance,
  from = "gallery",
  disabled,
  onOverride,
  onUseInherited,
}: {
  inheritance: Inheritance;
  /** What the default comes from, as the editor knows it. */
  from?: string;
  disabled?: boolean;
  onOverride: () => void;
  onUseInherited: () => void;
}) {
  if (inheritance === "own") {
    return null;
  }
  const inherited = inheritance === "inherited";
  return (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-secondary-alt">
      {inherited ? `From ${from}` : "Overridden"}
      <span aria-hidden>·</span>
      <button
        type="button"
        disabled={disabled}
        onClick={inherited ? onOverride : onUseInherited}
        className={cn(
          "font-medium text-fg-primary underline underline-offset-2 hover:text-fg-secondary",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {inherited ? "Override" : `Use ${from}'s`}
      </button>
    </span>
  );
}
