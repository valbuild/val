import { ReactNode, useMemo, useState } from "react";
import { FileText, Image, Plus } from "lucide-react";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import { PanelRow, PanelFilterInput } from "./PanelPrimitives";
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
        <PanelFilterInput
          value={query}
          onChange={setQuery}
          placeholder="Filter media…"
        />
      }
    >
      <div className="py-2">
        {filtered.length === 0 ? (
          <PanelEmptyState>
            {query ? "No galleries match your search." : "No galleries yet."}
          </PanelEmptyState>
        ) : (
          filtered.map((gallery) => (
            <PanelRow
              key={gallery.id}
              selected={selectedId === gallery.id}
              title={gallery.directory}
              onClick={() => onSelect(gallery)}
              leading={
                gallery.mediaType === "images" ? (
                  <Image size={13} className="text-fg-secondary-alt" />
                ) : (
                  <FileText size={13} className="text-fg-secondary-alt" />
                )
              }
              label={gallery.name}
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
