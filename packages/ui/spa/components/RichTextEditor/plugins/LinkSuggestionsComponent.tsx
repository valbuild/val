import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Info, Link2, X } from "lucide-react";
import { Button } from "../../designSystem/button";
import { Checkbox } from "../../designSystem/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../designSystem/popover";
import { cn } from "../../designSystem/cn";
import { describeFinding, type LinkFinding, type LinkScan } from "../linkify";

/** Stable for as long as the finding is where it was. */
export function findingKey(finding: LinkFinding): string {
  return `${finding.source}:${finding.from}:${finding.to}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function FindingTarget({ finding }: { finding: LinkFinding }) {
  const { resolution } = finding;
  const href = resolution.status === "linkable" ? resolution.href : null;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg-secondary" title={finding.url}>
        {finding.url}
      </span>
      {href !== null && href !== finding.url && (
        <span className="truncate text-fg-primary" title={href}>
          → {href}
        </span>
      )}
    </span>
  );
}

/**
 * "3 URLs aren't links yet — [Review] [Link all]", under the field.
 *
 * For what paste and typing did not catch: text that was already there, a
 * paste that came in as plain text from somewhere the chip was dismissed, a
 * link someone wrote out as the site's full address. Missing pages are listed
 * too, because the inline highlight is only visible where you have scrolled
 * to — and unlike the rest they cannot be dismissed, since they are errors.
 */
export function LinkSuggestionsBar({
  scan,
  dismissed,
  onApply,
  onDismiss,
  onReveal,
  portalContainer,
}: {
  scan: LinkScan;
  /** URLs someone said to leave as text, this session. */
  dismissed: ReadonlySet<string>;
  onApply: (keys: ReadonlySet<string> | null) => void;
  onDismiss: (urls: string[]) => void;
  onReveal: (finding: LinkFinding) => void;
  portalContainer?: HTMLElement | null;
}) {
  const fixable = useMemo(
    () => scan.fixable.filter((finding) => !dismissed.has(finding.url)),
    [scan.fixable, dismissed],
  );
  const notAllowed = useMemo(
    () => scan.notAllowed.filter((finding) => !dismissed.has(finding.url)),
    [scan.notAllowed, dismissed],
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  if (
    fixable.length === 0 &&
    scan.missing.length === 0 &&
    notAllowed.length === 0
  ) {
    return null;
  }

  const bare = fixable.filter((finding) => finding.source === "text").length;
  const rewrites = fixable.length - bare;
  const summary = [
    bare > 0
      ? `${plural(bare, "URL isn't a link", "URLs aren't links")} yet`
      : null,
    rewrites > 0
      ? `${plural(rewrites, "link uses", "links use")} this site's full address`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="mt-1 flex flex-col gap-1 rounded-md border border-border-primary bg-bg-secondary px-3 py-1.5 text-sm"
      data-testid="link-suggestions-bar"
    >
      {fixable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Link2 size={14} className="shrink-0 text-fg-secondary" />
          <span className="min-w-0 flex-1 text-fg-secondary">{summary}</span>
          <Popover
            open={reviewOpen}
            onOpenChange={(open) => {
              // Everything ticked on open, which is what "Link all" would do.
              if (open) setSelected(new Set(fixable.map(findingKey)));
              setReviewOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="xs">
                Review
              </Button>
            </PopoverTrigger>
            <PopoverContent
              container={portalContainer}
              align="end"
              className="w-96 max-w-[90vw] p-0"
            >
              <ul className="max-h-72 overflow-y-auto p-1">
                {fixable.map((finding) => {
                  const key = findingKey(finding);
                  return (
                    <li key={key}>
                      <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-bg-secondary">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(key)}
                          onCheckedChange={(checked) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                        />
                        <FindingTarget finding={finding} />
                        {finding.resolution.status === "linkable" && (
                          <span className="ml-auto shrink-0 rounded bg-bg-tertiary px-1.5 text-xs text-fg-secondary">
                            {finding.resolution.internal ? "Page" : "External"}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end gap-2 border-t border-border-primary p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setReviewOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={selected.size === 0}
                  onClick={() => {
                    onApply(selected);
                    setReviewOpen(false);
                  }}
                >
                  Link {selected.size}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            size="xs"
            onClick={() => onApply(new Set(fixable.map(findingKey)))}
          >
            {rewrites > 0 ? "Fix all" : "Link all"}
          </Button>
          <button
            type="button"
            aria-label="Leave these as text"
            title="Leave these as text"
            className="rounded p-1 text-fg-secondary hover:bg-bg-secondary-hover"
            onClick={() =>
              onDismiss([...fixable, ...notAllowed].map((f) => f.url))
            }
          >
            <X size={14} />
          </button>
        </div>
      )}
      {scan.missing.map((finding) => (
        <button
          key={findingKey(finding)}
          type="button"
          className="flex items-center gap-2 text-left text-fg-error-primary hover:underline"
          onClick={() => onReveal(finding)}
        >
          <AlertCircle size={14} className="shrink-0" />
          <span className="min-w-0 truncate">{describeFinding(finding)}</span>
        </button>
      ))}
      {notAllowed.length > 0 && (
        <div
          className="flex items-center gap-2 text-fg-secondary"
          title={notAllowed.map((f) => f.url).join("\n")}
        >
          <Info size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {plural(notAllowed.length, "URL can't", "URLs can't")} be linked
            from this field: it only links to pages in this project
          </span>
          {fixable.length === 0 && (
            <button
              type="button"
              aria-label="Hide"
              className="rounded p-1 hover:bg-bg-secondary-hover"
              onClick={() => onDismiss(notAllowed.map((f) => f.url))}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "✓ Linked · Keep as text", right under what was pasted.
 *
 * The paste already happened and so did the linking: this is how to take back
 * the part of it that was a guess, without also losing the paste.
 */
export function AutoLinkChip({
  count,
  position,
  onKeepAsText,
  onClose,
}: {
  count: number;
  position: { left: number; top: number };
  onKeepAsText: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      role="status"
      className={cn(
        "absolute z-window flex items-center gap-1 rounded-md border border-border-primary",
        "bg-bg-primary py-0.5 pl-2 pr-0.5 text-xs text-fg-secondary shadow-md",
      )}
      style={{ left: position.left, top: position.top }}
      data-testid="auto-link-chip"
      onMouseDown={(event) => event.preventDefault()}
    >
      <Check size={12} className="text-fg-brand-primary" />
      <span>{count === 1 ? "Linked" : `Linked ${count} URLs`}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-6 px-1.5 text-xs"
        onClick={onKeepAsText}
      >
        Keep as text
      </Button>
    </div>
  );
}
