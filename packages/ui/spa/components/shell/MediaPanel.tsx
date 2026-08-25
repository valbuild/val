import { ReactNode, useMemo, useState } from "react";
import { FileText, Image, Plus } from "lucide-react";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import {
  PanelErrorState,
  PanelFilterInput,
  PanelRow,
  PanelSkeleton,
} from "./PanelPrimitives";
import { ShellBreakpoint, ShellMediaGallery } from "./types";

export type MediaPanelProps = {
  breakpoint: ShellBreakpoint;
  media: ShellMediaGallery[];
  selectedId: string | null;
  onSelect: (gallery: ShellMediaGallery) => void;
  onUpload: () => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
  /** Show placeholder rows instead of content while data loads. */
  isLoading?: boolean;
  /** Message to show instead of content when the data could not be loaded. */
  loadError?: string;
  onRetryLoad?: () => void;
};

/** Media galleries — `s.images()` / `s.files()` modules, by directory. */
export function MediaPanel({
  breakpoint,
  media,
  selectedId,
  onSelect,
  onUpload,
  onClose,
  navSwitcher,
  isLoading,
  loadError,
  onRetryLoad,
}: MediaPanelProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query) return media;
    const q = query.toLowerCase();
    return media.filter(
      (gallery) =>
        gallery.name.toLowerCase().includes(q) ||
        gallery.directory.toLowerCase().includes(q),
    );
  }, [media, query]);
  return (
    <FloatingPanel
      side="left"
      width={300}
      title="Media"
      mobileVariant="sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      subheader={navSwitcher}
      headerAction={
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Plus size={13} />
          Upload
        </button>
      }
      sticky={
        isLoading || loadError ? undefined : (
          <PanelFilterInput
            value={query}
            onChange={setQuery}
            placeholder="Filter media…"
          />
        )
      }
    >
      <div className="py-2">
        {isLoading ? (
          <PanelSkeleton />
        ) : loadError ? (
          <PanelErrorState message={loadError} onRetry={onRetryLoad} />
        ) : filtered.length === 0 ? (
          <PanelEmptyState>
            {query ? "No galleries match this filter." : "No galleries yet."}
          </PanelEmptyState>
        ) : (
          filtered.map((gallery) => (
            <PanelRow
              key={gallery.id}
              selected={selectedId === gallery.id}
              // The module, because that is what the row opens and what
              // identifies it; the directory is already on the row as its
              // label and its meta.
              title={gallery.moduleFilePath}
              onClick={() => onSelect(gallery)}
              leading={
                gallery.mediaType === "images" ? (
                  <Image size={13} className="text-fg-secondary-alt" />
                ) : (
                  <FileText size={13} className="text-fg-secondary-alt" />
                )
              }
              label={gallery.name}
              meta={gallery.directory}
              trailing={
                <span className="text-[0.6875rem] tabular-nums text-fg-secondary-alt">
                  {gallery.itemCount}
                </span>
              }
            />
          ))
        )}
      </div>
    </FloatingPanel>
  );
}
