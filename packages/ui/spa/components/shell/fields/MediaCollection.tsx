import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Folder,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { FileGlyph } from "./FileField";
import { HotspotPicker } from "./HotspotPicker";
import { Section } from "./ImageField";
import { formatBytes } from "./formatBytes";
import { ImageEntry, MediaEntry, MediaFolder } from "./types";

/**
 * How the collection is being used right now.
 *
 * `manage` is the `s.images()` / `s.files()` module open in the editor:
 * everything is editable and nothing is being chosen. `browse` is the same
 * module opened from a field, where the point is to leave with one item.
 *
 * One component for both because they are one thing — a collection is a
 * module you can edit, and picking from it is that module in selection mode.
 * Two components would drift, and then "the library" and "the picker" would
 * quietly disagree about what a collection contains.
 */
export type MediaCollectionMode = "manage" | "browse";

export type MediaCollectionProps = {
  /** Module file path, e.g. "/content/media.val.ts". */
  moduleFilePath: string;
  name: string;
  entries: MediaEntry[];
  folders?: MediaFolder[];
  /** Directory the collection is constrained to, from the schema. */
  directory: string;
  /** What the schema accepts, e.g. "image/*". */
  accept: string;
  mode: MediaCollectionMode;
  selectedRef?: string | null;
  onSelect: (ref: string) => void;
  onChangeEntry?: (entry: MediaEntry) => void;
  onDelete?: (ref: string) => void;
  onUpload: () => void;
  /** `browse` only: take the selected entry and close. */
  onConfirm?: (ref: string) => void;
  onCancel?: () => void;
};

export function MediaCollection({
  moduleFilePath,
  name,
  entries,
  folders = [],
  directory,
  accept,
  mode,
  selectedRef = null,
  onSelect,
  onChangeEntry,
  onDelete,
  onUpload,
  onConfirm,
  onCancel,
}: MediaCollectionProps) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        (entry.kind === "image" && (entry.alt ?? "").toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const selected = entries.find((entry) => entry.ref === selectedRef) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border-float bg-bg-float">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-float px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.8125rem] font-semibold tracking-tight text-fg-primary">
            {name}
          </h2>
          <p className="truncate font-mono text-[0.6875rem] text-fg-secondary-alt">
            {moduleFilePath}
          </p>
        </div>
        <span className="shrink-0 text-[0.6875rem] tabular-nums text-fg-secondary-alt">
          {entries.length}
        </span>
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-float px-2.5 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Upload size={13} />
          Upload
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border-float px-3 py-2">
        <span className="relative flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary-alt"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or alt text…"
            className="h-8 w-full rounded-md border border-border-float bg-bg-surface pl-8 pr-2 text-xs text-fg-primary outline-none placeholder:text-fg-secondary-alt focus:border-border-primary"
          />
        </span>
        {/*
         * The schema's own constraints, shown rather than enforced silently.
         * A collection that only takes `image/*` into `/public/val/images` is
         * the reason an upload gets rejected, so it should be readable before
         * the upload rather than in the error afterwards.
         */}
        <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[0.625rem] text-fg-secondary-alt sm:inline-flex">
          {accept} → {directory}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-slim">
          {folders.length > 0 && (
            <ul className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {folders.map((folder) => (
                <li key={folder.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md border border-border-float px-2.5 py-2 text-left hover:bg-bg-float-raised"
                  >
                    <Folder size={14} className="shrink-0 text-fg-secondary" />
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-primary">
                      {folder.name}
                    </span>
                    <span className="shrink-0 text-[0.625rem] tabular-nums text-fg-secondary-alt">
                      {folder.itemCount}
                    </span>
                    <ChevronRight
                      size={13}
                      className="shrink-0 text-fg-secondary-alt"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {shown.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-fg-secondary-alt">
              {entries.length === 0
                ? "Nothing here yet. Uploads land in this collection and can be used by any field that points at it."
                : "Nothing matches that filter."}
            </p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {shown.map((entry) => (
                <li key={entry.ref}>
                  <EntryTile
                    entry={entry}
                    isSelected={entry.ref === selectedRef}
                    onSelect={() => onSelect(entry.ref)}
                    onConfirm={
                      mode === "browse" && onConfirm
                        ? () => onConfirm(entry.ref)
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border-float p-3 scrollbar-slim lg:block">
            <EntryInspector
              entry={selected}
              editable={mode === "manage"}
              onChange={onChangeEntry}
              onDelete={onDelete}
            />
          </aside>
        )}
      </div>

      {mode === "browse" && (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-float px-3 py-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-xs text-fg-secondary hover:text-fg-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedRef === null}
            onClick={() => selectedRef && onConfirm?.(selectedRef)}
            className={cn(
              "inline-flex h-8 items-center rounded-md px-3 text-xs font-medium",
              selectedRef === null
                ? "cursor-not-allowed bg-bg-float-raised text-fg-disabled"
                : "border border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover",
            )}
          >
            Use this one
          </button>
        </footer>
      )}
    </div>
  );
}

function EntryTile({
  entry,
  isSelected,
  onSelect,
  onConfirm,
}: {
  entry: MediaEntry;
  isSelected: boolean;
  onSelect: () => void;
  /** Present in browse mode: double-clicking picks without a second trip. */
  onConfirm?: () => void;
}) {
  const missingAlt = entry.kind === "image" && !entry.alt;
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      onDoubleClick={onConfirm}
      className={cn(
        "group w-full overflow-hidden rounded-md border text-left",
        // The brand border, not `--bg-page-selection`: that one is drawn on
        // the customer's page and deliberately does not follow Val's theme,
        // so it has no business marking a selection inside Val's own chrome.
        isSelected
          ? "border-border-brand-primary ring-1 ring-border-brand-primary"
          : "border-border-float hover:border-border-primary",
      )}
    >
      <span className="block aspect-[4/3] overflow-hidden bg-bg-float-raised">
        {entry.kind === "image" ? (
          <img
            src={entry.url}
            alt=""
            style={{
              objectPosition: entry.hotspot
                ? `${entry.hotspot.x * 100}% ${entry.hotspot.y * 100}%`
                : undefined,
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <FileGlyph
            mimeType={entry.mimeType}
            className="grid h-full w-full place-items-center"
          />
        )}
      </span>
      <span className="block px-2 py-1.5">
        <span className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-fg-primary">
            {entry.name}
          </span>
          {missingAlt && (
            // Not an error — an image with no alt text is valid unless the
            // schema says otherwise. It is worth seeing at a glance all the
            // same, because it is the thing everyone forgets.
            <AlertTriangle
              size={11}
              aria-label="No alt text"
              className="shrink-0 text-fg-warning-primary"
            />
          )}
        </span>
        <span className="block truncate text-[0.625rem] tabular-nums text-fg-secondary-alt">
          {entry.kind === "image"
            ? `${entry.width} × ${entry.height}`
            : formatBytes(entry.size)}
        </span>
      </span>
    </button>
  );
}

/**
 * The selected entry's own metadata.
 *
 * In `manage` mode this is the actual editor for the record entry, which is
 * why alt text and the focal point live here rather than on the field: they
 * belong to the image, and every field pointing at it starts from them.
 */
function EntryInspector({
  entry,
  editable,
  onChange,
  onDelete,
}: {
  entry: MediaEntry;
  editable: boolean;
  onChange?: (entry: MediaEntry) => void;
  onDelete?: (ref: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="break-all text-xs font-medium text-fg-primary">
          {entry.name}
        </p>
        <p className="mt-0.5 text-[0.6875rem] text-fg-secondary-alt">
          {entry.kind === "image"
            ? `${entry.width} × ${entry.height} · ${formatBytes(entry.size)}`
            : formatBytes(entry.size)}
        </p>
        <p className="mt-0.5 break-all font-mono text-[0.625rem] text-fg-secondary-alt">
          {entry.ref}
        </p>
      </div>

      {entry.kind === "image" && (
        <>
          <Section label="Alt text">
            <textarea
              value={entry.alt ?? ""}
              readOnly={!editable}
              rows={2}
              placeholder="What the image shows"
              onChange={(event) =>
                onChange?.({ ...entry, alt: event.target.value })
              }
              className="w-full resize-none rounded-md border border-border-float bg-bg-surface px-2.5 py-1.5 text-xs text-fg-primary outline-none placeholder:text-fg-secondary-alt focus:border-border-primary"
            />
          </Section>
          {editable && (
            <Section label="Focal point">
              <HotspotPicker
                url={entry.url}
                alt={entry.alt ?? entry.name}
                hotspot={entry.hotspot}
                onChange={(hotspot) =>
                  onChange?.({ ...entry, hotspot } satisfies ImageEntry)
                }
              />
            </Section>
          )}
        </>
      )}

      {editable && onDelete && (
        <button
          type="button"
          onClick={() => onDelete(entry.ref)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-secondary hover:text-fg-error-on-surface"
        >
          <Trash2 size={13} />
          Delete from collection
        </button>
      )}
    </div>
  );
}
