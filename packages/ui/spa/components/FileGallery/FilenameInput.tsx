import * as React from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import { splitEditableFilename } from "../../utils/renameMediaFile";

interface FilenameInputProps {
  filename: string;
  /**
   * Called with the whole new filename, locked part included.
   *
   * May return a promise of an error message (or `null` on success): the input
   * then stays open and busy until it resolves, and shows the message if there
   * is one — a rename reads bytes and uploads them, so it is not instant and it
   * can fail.
   */
  onSave: (newFilename: string) => void | Promise<string | null>;
  disabled?: boolean;
  className?: string;
  /** Open straight into editing, for a control that exists only to rename. */
  defaultEditing?: boolean;
  /** Called when editing ends without saving. */
  onCancel?: () => void;
}

/**
 * A filename an editor can change the front of.
 *
 * What is LOCKED is everything Val chose: the extension, and the `_a1b2c` hash
 * suffix an upload gives every file. They are shown beside the input rather
 * than in it, because they are not the editor's to change — see
 * `Internal.createRenamedFilename`.
 */
export function FilenameInput({
  filename,
  onSave,
  disabled = false,
  className,
  defaultEditing = false,
  onCancel,
}: FilenameInputProps) {
  const [isEditing, setIsEditing] = React.useState(defaultEditing);
  const { base, locked } = splitEditableFilename(filename);
  const [editedName, setEditedName] = React.useState(base);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEditedName(splitEditableFilename(filename).base);
    setError(null);
    if (!defaultEditing) {
      setIsEditing(false);
    }
  }, [filename]);

  const handleSave = async () => {
    const trimmedName = editedName.trim();
    if (!trimmedName || trimmedName === base) {
      setIsEditing(defaultEditing);
      onCancel?.();
      return;
    }
    const result = onSave(trimmedName + locked);
    if (result === undefined) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const message = await result;
    setSaving(false);
    if (message !== null) {
      setError(message);
      return;
    }
    setIsEditing(defaultEditing);
  };

  const handleCancel = () => {
    setEditedName(base);
    setError(null);
    setIsEditing(false);
    onCancel?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Escape") {
      // Inside a dialog or popover, Escape would otherwise close the whole
      // thing as well as the edit.
      e.stopPropagation();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div className="flex items-center gap-1">
          <div className="flex flex-1 items-center">
            <Input
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={saving}
              autoFocus
              aria-label="File name"
              aria-invalid={error !== null}
              className={cn("h-8 flex-1 text-sm", locked && "rounded-r-none")}
            />
            {locked && (
              <span
                className="flex h-8 items-center rounded-r-md border border-l-0 border-border-primary bg-bg-secondary px-2 text-sm text-fg-secondary"
                title="Val keeps the content hash and the file type"
              >
                {locked}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary disabled:opacity-50"
            title="Save"
            aria-label="Save file name"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary disabled:opacity-50"
            title="Cancel"
            aria-label="Cancel renaming"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-fg-error-primary">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span
        className="flex-1 truncate rounded px-2 py-1.5 text-sm text-fg-primary"
        title={filename}
      >
        {filename}
      </span>
      {!disabled && (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          title="Rename"
          aria-label="Rename file"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
