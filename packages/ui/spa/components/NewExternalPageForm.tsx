import { useState } from "react";
import { describeSchemeRejection, rejectScheme } from "@valbuild/core";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";

/**
 * Creating an entry in the external page router.
 *
 * Its keys are absolute URLs rather than route patterns, so it gets a plain
 * input rather than the per-segment inputs `NewPageForm` builds. The rule is
 * the one `externalPageRouter.validate` enforces server-side - `rejectScheme`
 * is literally the same function, called here so the editor sees the refusal
 * while typing rather than as a validation error on a key already saved.
 */
export function NewExternalPageForm({
  existingKeys,
  schemes,
  onSubmit,
  onCancel,
}: {
  existingKeys: string[];
  /**
   * The schemes this project's router allows, when it narrowed them.
   *
   * Absent is the default and the common case: anything but the handful that
   * are not links at all, so `mailto:` and `tel:` are ordinary keys here.
   */
  schemes?: readonly string[];
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const trimmed = url.trim();
  const alreadyExists = existingKeys.includes(trimmed);
  const rejection = rejectScheme(trimmed, schemes ? { schemes } : {});
  const error = !trimmed
    ? null
    : rejection !== null
      ? describeSchemeRejection(rejection)
      : alreadyExists
        ? "This external page already exists"
        : null;
  const disabled = !trimmed || error !== null;

  return (
    <form
      className="p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        onSubmit(trimmed);
      }}
    >
      <div className="text-sm font-medium text-fg-primary">
        New external page
      </div>
      <div className="space-y-1">
        <input
          autoFocus
          className={cn(
            "w-full p-1 bg-bg-secondary border border-border-primary rounded text-fg-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
            { "border-fg-error-on-surface": error !== null },
          )}
          placeholder={placeholderFor(schemes)}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {error && <p className="text-xs text-fg-error-on-surface">{error}</p>}
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={disabled}>
          Create
        </Button>
      </div>
    </form>
  );
}

/**
 * A placeholder that is an example of what this router takes.
 *
 * `https://example.com` where anything goes, and the first allowed scheme
 * where a project narrowed the list — showing `https://` to a router that
 * only takes `mailto:` would be an example of the one thing it refuses.
 */
function placeholderFor(schemes: readonly string[] | undefined): string {
  const first = schemes?.[0]?.toLowerCase();
  if (first === undefined || first === "https" || first === "http") {
    return `${first ?? "https"}://example.com`;
  }
  if (first === "mailto") {
    return "mailto:post@example.com";
  }
  if (first === "tel") {
    return "tel:+4712345678";
  }
  return `${first}:`;
}
