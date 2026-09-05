import { Check, Languages } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { localeName } from "../../utils/localeName";
import { useDismissOnOutsidePointer } from "./useDismissOnOutsidePointer";

/**
 * Which language the studio is showing, as a control in the chrome.
 *
 * A view filter rather than an action, which is why it sits at the head of the
 * top bar's right-hand cluster rather than among the icon buttons: it changes
 * what you are looking at, not what happens next.
 *
 * **It changes what is LISTED, never what is reachable.** A link to a Norwegian
 * page opens that page while the filter says English — the filter is for
 * working through one language, not a permission on the content. Content in NO
 * language is always shown, which in most projects is most of it.
 *
 * Renders nothing at all where the project has declared no languages. A picker
 * offering only "All locales" is furniture that explains nothing, and every
 * project that is not translated would carry it.
 */
export function LocaleFilter({
  locales,
  value,
  onChange,
  className,
  menuPlacement = "below",
}: {
  /** `locales.available` from the settings module, in the project's order. */
  locales: string[];
  /** The language being shown, or `null` for all of them. */
  value: string | null;
  onChange: (locale: string | null) => void;
  className?: string;
  /**
   * Which way the menu opens.
   *
   * `above` for the mobile bottom bar, where a menu that drops down from a
   * control at the bottom of the screen opens off the screen. The same reason
   * `PreviewButton` has it.
   */
  menuPlacement?: "below" | "above";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (locales.length === 0) {
    return null;
  }
  // A value the project does not have — a hand-edited link, or a language that
  // has since been removed — reads as no filter rather than as an empty studio.
  const selected = value !== null && locales.includes(value) ? value : null;
  return (
    <div ref={containerRef} className={cn("relative h-8", className)}>
      <button
        type="button"
        aria-label={
          selected === null
            ? "Showing all languages"
            : `Showing ${localeName(selected) ?? selected}`
        }
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "inline-flex h-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
          "hover:bg-bg-float-raised hover:text-fg-primary",
          selected === null
            ? "border-border-float text-fg-secondary"
            : "border-border-float bg-bg-float-raised text-fg-primary",
        )}
      >
        <Languages size={14} />
        <span className="tabular-nums">{selected ?? "All"}</span>
      </button>
      {isOpen && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-full w-56 rounded-md border border-border-float bg-bg-float py-1 shadow-lg",
            menuPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          <LocaleFilterItem
            label="All locales"
            detail="Every language, and everything with none"
            isSelected={selected === null}
            onClick={() => {
              setIsOpen(false);
              onChange(null);
            }}
          />
          {locales.map((locale) => (
            <LocaleFilterItem
              key={locale}
              label={localeName(locale) ?? locale}
              detail={locale}
              isSelected={selected === locale}
              onClick={() => {
                setIsOpen(false);
                onChange(locale);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LocaleFilterItem({
  label,
  detail,
  isSelected,
  onClick,
}: {
  label: string;
  detail: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isSelected}
      onClick={onClick}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-bg-float-raised"
    >
      <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-fg-primary">
        {isSelected && <Check size={13} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-fg-primary">
          {label}
        </span>
        <span className="block truncate text-[0.6875rem] text-fg-secondary-alt">
          {detail}
        </span>
      </span>
    </button>
  );
}
