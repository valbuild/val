import { useState } from "react";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";

/**
 * Creating an entry in the external page router.
 *
 * Its keys are absolute URLs rather than route patterns, so it gets a plain
 * input rather than the per-segment inputs `NewPageForm` builds. The rule is
 * the one `externalPageRouter.validate` enforces server-side - checked here so
 * the editor sees it while typing rather than as a validation error afterwards.
 */
export function NewExternalPageForm({
  existingKeys,
  onSubmit,
  onCancel,
}: {
  existingKeys: string[];
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const trimmed = url.trim();
  const alreadyExists = existingKeys.includes(trimmed);
  const hasScheme =
    trimmed.startsWith("https://") || trimmed.startsWith("http://");
  const error = !trimmed
    ? null
    : !hasScheme
      ? "Must start with https:// or http://"
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
            { "border-fg-error": error !== null },
          )}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {error && <p className="text-xs text-fg-error">{error}</p>}
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
