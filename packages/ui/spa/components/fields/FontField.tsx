import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { getRefParts } from "@valbuild/shared/internal";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";
import { FontSpecimen } from "../FontPreview";
import { useModuleMediaEntries } from "../MediaPicker/useModuleMediaEntries";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";
import { useNavigation } from "../ValRouter";

/**
 * A font field (`s.font(fontsVal)`, or any `s.file()` picked from a font set)
 * as one row of its parent: the font's "A", set in itself, and its file name.
 *
 * A row rather than the field, because what a font field edits — which of the
 * set's fonts — needs the set in front of you, and a parent's field list has
 * no room for a grid of fonts beside every other field. So the row says which
 * font it is, and a click opens the field, where the set is.
 *
 * It asks for the router itself, as `ViewField` does, so the field it is cut
 * from does not need one to render.
 */
export function FontFieldRow({
  path,
  url,
  filename,
}: {
  /** The field's own path: where a click takes the editor. */
  path: SourcePath;
  /** The chosen font's URL, or null when none is chosen. */
  url: string | null;
  filename: string | null;
}) {
  const { navigate } = useNavigation();
  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      aria-label={filename ? `Font: ${filename}` : "Choose a font"}
      className="flex w-full items-center gap-3 rounded-md border border-border-primary p-2 text-left hover:bg-bg-secondary"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded bg-bg-secondary">
        {url ? (
          <FontSpecimen
            url={url}
            variant="tile"
            text="A"
            tileFontSize="1.5rem"
          />
        ) : (
          <span className="text-lg text-fg-secondary-alt">–</span>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          filename ? "text-fg-primary" : "italic text-fg-secondary",
        )}
      >
        {filename ?? "No font chosen"}
      </span>
      <ChevronRight size={16} className="shrink-0 text-fg-secondary" />
    </button>
  );
}

/**
 * Every font in the set, each set in itself, to pick one from.
 *
 * What a font field shows once it is opened. The tiles are the gallery's —
 * "Aa" and the file name — so a font looks the same here as where it was
 * uploaded.
 */
export function FontSetGrid({
  modulePath,
  selectedRef,
  onSelect,
  disabled,
}: {
  modulePath: ModuleFilePath;
  selectedRef: string | null;
  onSelect: (ref: string) => void;
  disabled?: boolean;
}) {
  const { moduleEntries, getUrl, ready } = useModuleMediaEntries(modulePath);
  if (!ready) {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-secondary">
        <Loader2 size={14} className="animate-spin" />
        Loading the fonts…
      </div>
    );
  }
  const refs = Object.keys(moduleEntries[modulePath] ?? {});
  return (
    <section
      aria-label={`Fonts in ${prettyModuleName(modulePath)}`}
      className="flex flex-col gap-2"
    >
      <h3 className="text-xs font-medium text-fg-secondary">
        Fonts in {prettyModuleName(modulePath)}
      </h3>
      {refs.length === 0 ? (
        <p className="text-xs text-fg-secondary">
          The set has no fonts yet. Upload one to add it.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          {refs.map((ref) => {
            const selected = ref === selectedRef;
            const { filename } = getRefParts(ref);
            return (
              <button
                key={ref}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                title={filename}
                onClick={() => onSelect(ref)}
                className={cn(
                  "flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left",
                  "transition-colors hover:bg-bg-secondary disabled:pointer-events-none disabled:opacity-60",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
                  selected && "bg-bg-secondary ring-2 ring-border-focus",
                )}
              >
                <span className="aspect-square w-full overflow-hidden rounded-md bg-bg-tertiary">
                  <FontSpecimen url={getUrl(ref)} variant="tile" />
                </span>
                <span className="truncate px-0.5 text-xs font-medium text-fg-primary">
                  {filename}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
