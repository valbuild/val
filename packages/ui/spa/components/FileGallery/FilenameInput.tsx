import * as React from "react";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";

interface FilenameInputProps {
  filename: string;
  onSave: (newFilename: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Splits a filename into name and extension.
 * E.g., "photo.jpg" -> ["photo", ".jpg"]
 * E.g., "archive.tar.gz" -> ["archive.tar", ".gz"]
 * E.g., "README" -> ["README", ""]
 */
function splitFilename(filename: string): [string, string] {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    // No extension or starts with dot (hidden file)
    return [filename, ""];
  }
  return [filename.slice(0, lastDotIndex), filename.slice(lastDotIndex)];
}

export function FilenameInput({
  filename,
  onSave,
  disabled = false,
  className,
}: FilenameInputProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [name, extension] = splitFilename(filename);
  const [editedName, setEditedName] = React.useState(name);

  React.useEffect(() => {
    const [newName] = splitFilename(filename);
    setEditedName(newName);
    setIsEditing(false);
  }, [filename]);

  const handleSave = () => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== name) {
      onSave(trimmedName + extension);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedName(name);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <div className="flex flex-1 items-center">
          <Input
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="h-8 flex-1 rounded-r-none text-sm"
          />
          {extension && (
            <span className="flex h-8 items-center rounded-r-md border border-l-0 border-border-primary bg-bg-secondary px-2 text-sm text-fg-secondary">
              {extension}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          title="Save"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
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
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
