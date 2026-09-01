import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
} from "lucide-react";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import {
  PanelErrorState,
  PanelFilterInput,
  PanelRow,
  PanelSkeleton,
} from "./PanelPrimitives";
import { cn } from "../designSystem/cn";
import { ShellBreakpoint, ShellMediaFile, ShellMediaGallery } from "./types";
import { servedPath } from "../../utils/mediaPath";
import { MediaThumbnail } from "../MediaThumbnail";
import { useDismissOnOutsidePointer } from "./useDismissOnOutsidePointer";

export type MediaPanelProps = {
  breakpoint: ShellBreakpoint;
  media: ShellMediaGallery[];
  selectedId: string | null;
  onSelect: (gallery: ShellMediaGallery) => void;
  /** Open one file in the editor. */
  onSelectFile?: (gallery: ShellMediaGallery, file: ShellMediaFile) => void;
  /**
   * A thumbnail URL for a file, or null when there is nothing to show one from.
   *
   * Supplied by the app because the answer depends on whether the file has an
   * uncommitted patch: a just-uploaded image lives behind `/api/val/files` with
   * a patch id, and the published one does not.
   */
  getFileUrl?: (ref: string) => string | null;
  /**
   * Upload into one gallery.
   *
   * Which gallery is the panel's question to ask: a project can have several,
   * they have different directories, and one takes images while the next takes
   * arbitrary files — so an Upload button that guesses is a button that puts
   * files in the wrong place. Absent when the app cannot upload at all.
   */
  onUpload?: (gallery: ShellMediaGallery) => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
  /** Show placeholder rows instead of content while data loads. */
  isLoading?: boolean;
  /** Message to show instead of content when the data could not be loaded. */
  loadError?: string;
  onRetryLoad?: () => void;
};

/**
 * How many files are rendered before a gallery asks to show more.
 *
 * A gallery can hold thousands, and every row is a DOM node with an image in
 * it. The chunk is what keeps opening one from freezing the panel; the rest
 * arrive as you reach them.
 */
const CHUNK = 40;

/**
 * Media galleries, and the files in them.
 *
 * Closed by default, all of them. A gallery's rows are cheap — its record keys
 * are already loaded, because that is what a gallery *is* — but its thumbnails
 * are not: opening every gallery on mount would fetch every image in the
 * project to draw them at 24 pixels. So a gallery is opened deliberately, and
 * even then its images load only as they are scrolled to.
 *
 * The files are shown as the tree their paths describe, for the same reason the
 * Data panel is a tree: a gallery constrained to `/public/val/images` can still
 * have subdirectories under it, and a flat list of two hundred names stops
 * saying where anything is.
 */
export function MediaPanel({
  breakpoint,
  media,
  selectedId,
  onSelect,
  onSelectFile,
  getFileUrl,
  onUpload,
  onClose,
  navSwitcher,
  isLoading,
  loadError,
  onRetryLoad,
}: MediaPanelProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const q = query.trim().toLowerCase();

  /**
   * Galleries, with the files that match the filter.
   *
   * A filter reaches inside: typing a file name should find the file, not only
   * the gallery it is in — which means a matching gallery is kept even when
   * nothing in it matches, and a gallery is kept when something in it does.
   */
  const filtered = useMemo(() => {
    if (!q) return media.map((gallery) => ({ gallery, files: gallery.files }));
    return media
      .map((gallery) => {
        const galleryMatches =
          gallery.name.toLowerCase().includes(q) ||
          gallery.directory.toLowerCase().includes(q);
        const files = (gallery.files ?? []).filter((file) =>
          file.ref.toLowerCase().includes(q),
        );
        return { gallery, files, galleryMatches };
      })
      .filter(({ files, galleryMatches }) => galleryMatches || files.length > 0)
      .map(({ gallery, files, galleryMatches }) => ({
        gallery,
        // A gallery matched by its own name shows everything in it; one matched
        // by its contents shows only what matched.
        files: galleryMatches && files.length === 0 ? gallery.files : files,
      }));
  }, [media, q]);

  // While filtering, everything that survived is open: a match nobody can see
  // is not a match.
  const isOpen = (id: string) => (q ? true : expanded.has(id));

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        onUpload && media.length > 0 ? (
          <UploadMenu media={media} onUpload={onUpload} />
        ) : undefined
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
            {query ? "Nothing matches this filter." : "No galleries yet."}
          </PanelEmptyState>
        ) : (
          filtered.map(({ gallery, files }) => {
            const open = isOpen(gallery.id);
            return (
              <div key={gallery.id}>
                <PanelRow
                  selected={selectedId === gallery.id}
                  // The module, because that is what the row is about; the
                  // directory is the row's meta.
                  title={gallery.moduleFilePath}
                  expanded={open}
                  /*
                   * The row expands. That is all it does.
                   *
                   * It used to also `onSelect(gallery)`, which replaced whatever
                   * was in the editor — two outcomes from one target, and the
                   * louder one was the one nobody asked for: browsing the media
                   * tree cost you the page you were editing. Opening a gallery
                   * is now the `Open` action beside the row, which is
                   * deliberate and never something you trip over.
                   */
                  onClick={() => {
                    if (!q) toggle(gallery.id);
                  }}
                  action={
                    <button
                      type="button"
                      onClick={() => onSelect(gallery)}
                      title="Open in the editor"
                      aria-label={`Open ${gallery.name} in the editor`}
                      className={cn(
                        "ml-1 shrink-0 rounded px-1.5 h-6 text-[0.6875rem] text-fg-secondary",
                        "hover:bg-bg-float-raised hover:text-fg-primary",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
                        // Revealed on hover, because a row of always-on buttons
                        // reads as a wall of controls — but shown outright where
                        // there is no hover to reveal it with, and whenever it
                        // has focus, so the keyboard can reach it.
                        "opacity-0 transition-opacity",
                        "group-hover/row:opacity-100 focus-visible:opacity-100",
                        "[@media(hover:none)]:opacity-100",
                        selectedId === gallery.id && "opacity-100",
                      )}
                    >
                      Open
                    </button>
                  }
                  leading={
                    <span className="text-fg-secondary-alt">
                      {open ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </span>
                  }
                  label={gallery.name}
                  // The served path, not the ref: `/public` is the web root, so
                  // `/val/images` is what a URL to anything in here looks like.
                  meta={servedPath(gallery.directory)}
                  trailing={
                    <span className="text-[0.6875rem] tabular-nums text-fg-secondary-alt">
                      {gallery.itemCount}
                    </span>
                  }
                />
                {open && (
                  <GalleryFiles
                    gallery={gallery}
                    files={files}
                    selectedId={selectedId}
                    onSelectFile={onSelectFile}
                    getFileUrl={getFileUrl}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </FloatingPanel>
  );
}

/** The files in one gallery, as a tree, a chunk at a time. */
function GalleryFiles({
  gallery,
  files,
  selectedId,
  onSelectFile,
  getFileUrl,
}: {
  gallery: ShellMediaGallery;
  files: ShellMediaFile[] | undefined;
  selectedId: string | null;
  onSelectFile?: (gallery: ShellMediaGallery, file: ShellMediaFile) => void;
  getFileUrl?: (ref: string) => string | null;
}) {
  const [shown, setShown] = useState(CHUNK);

  // A different filter is a different list, so the chunk starts over.
  const signature = files?.length ?? -1;
  useEffect(() => setShown(CHUNK), [signature]);

  if (files === undefined) {
    return (
      <p className="flex items-center gap-1.5 pl-8 py-1.5 text-[0.6875rem] text-fg-secondary-alt">
        <Loader2 size={11} className="animate-spin" />
        Loading files…
      </p>
    );
  }
  if (files.length === 0) {
    return (
      <p className="pl-8 py-1.5 text-[0.6875rem] text-fg-secondary-alt">
        No files in this gallery yet.
      </p>
    );
  }

  const visible = files.slice(0, shown);
  const remaining = files.length - visible.length;
  const groups = groupByDirectory(visible, gallery.directory);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.directory}>
          {/* Only when there is more than one: a heading repeating the
              gallery's own directory on every row says nothing. */}
          {groups.length > 1 && (
            <p
              title={servedPath(group.directory)}
              className="truncate pl-8 pr-3 pt-1.5 pb-0.5 text-[0.625rem] uppercase tracking-wide text-fg-secondary-alt"
            >
              {group.label}
            </p>
          )}
          {group.files.map((file) => (
            <FileRow
              key={file.ref}
              gallery={gallery}
              file={file}
              selected={selectedId === file.sourcePath}
              onSelect={onSelectFile}
              getFileUrl={getFileUrl}
            />
          ))}
        </div>
      ))}
      {remaining > 0 && (
        <ShowMore
          remaining={remaining}
          onShowMore={() => setShown((current) => current + CHUNK)}
        />
      )}
    </div>
  );
}

/**
 * One file: a thumbnail and a name.
 *
 * `loading="lazy"` on the image is what makes a gallery of hundreds openable —
 * the rows are cheap, the bytes are not, and the browser is better than we are
 * at deciding which ones are about to be on screen.
 */
function FileRow({
  gallery,
  file,
  selected,
  onSelect,
  getFileUrl,
}: {
  gallery: ShellMediaGallery;
  file: ShellMediaFile;
  selected: boolean;
  onSelect?: (gallery: ShellMediaGallery, file: ShellMediaFile) => void;
  getFileUrl?: (ref: string) => string | null;
}) {
  const [failed, setFailed] = useState(false);
  const url = getFileUrl?.(file.ref) ?? null;
  const showImage = gallery.mediaType === "images" && url !== null && !failed;
  return (
    <div className="flex items-center pl-5 pr-2">
      <button
        type="button"
        onClick={() => onSelect?.(gallery, file)}
        title={servedPath(file.ref)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group flex items-center gap-2 min-w-0 flex-1 h-8 px-1.5 rounded-md text-xs text-left",
          selected
            ? "bg-bg-float-raised text-fg-primary font-medium"
            : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
        )}
      >
        <span className="grid place-items-center w-6 h-6 shrink-0 overflow-hidden rounded bg-bg-float-raised">
          {showImage ? (
            <MediaThumbnail
              url={url}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          ) : gallery.mediaType === "images" ? (
            <ImageIcon size={12} className="text-fg-secondary-alt" />
          ) : (
            <FileText size={12} className="text-fg-secondary-alt" />
          )}
        </span>
        <span className="truncate">{baseName(file.ref)}</span>
      </button>
    </div>
  );
}

/**
 * The next chunk, taken when it comes into view.
 *
 * A button as well as an observer: the observer is what makes scrolling feel
 * like one list, and the button is what works when there is no observer and
 * for anyone reaching it by keyboard.
 */
function ShowMore({
  remaining,
  onShowMore,
}: {
  remaining: number;
  onShowMore: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onShowMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onShowMore]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onShowMore}
      className="block w-full pl-8 pr-3 py-1.5 text-left text-[0.6875rem] text-fg-secondary-alt hover:text-fg-primary"
    >
      Show {Math.min(remaining, CHUNK)} more ({remaining} left)
    </button>
  );
}

/** `/public/val/images/logo_a1b2c.png` -> `logo_a1b2c.png` */
function baseName(ref: string): string {
  const segments = ref.split("/");
  return segments[segments.length - 1] || ref;
}

/**
 * Where to upload, as a menu.
 *
 * A list rather than a dialog, because the choice is small and the useful part
 * of each option is short: the directory the files will land in, and whether the
 * gallery takes images or anything. Both are on the row, because "Upload" with
 * neither of them is how a PDF ends up in the images folder.
 *
 * With one gallery there is no choice to make, so the button uploads straight
 * into it — but it still says which directory, for the same reason.
 */
function UploadMenu({
  media,
  onUpload,
}: {
  media: ShellMediaGallery[];
  onUpload: (gallery: ShellMediaGallery) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  const only = media.length === 1 ? media[0] : null;
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup={only ? undefined : "menu"}
        aria-expanded={only ? undefined : isOpen}
        title={
          only
            ? `Upload into ${servedPath(only.directory)}`
            : "Choose where to upload"
        }
        onClick={() => (only ? onUpload(only) : setIsOpen((open) => !open))}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
      >
        <Plus size={13} />
        Upload
        {!only && <ChevronDown size={12} />}
      </button>
      {isOpen && !only && (
        <div
          role="menu"
          className="absolute right-0 top-full z-window mt-1 w-64 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          {media.map((gallery) => (
            <button
              key={gallery.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onUpload(gallery);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              {gallery.mediaType === "images" ? (
                <ImageIcon size={13} className="mt-0.5 shrink-0" />
              ) : (
                <FileText size={13} className="mt-0.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">
                  {servedPath(gallery.directory)}
                </span>
                <span className="block text-[0.6875rem] text-fg-secondary-alt">
                  {gallery.mediaType === "images" ? "Images" : "Files"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Files grouped by the directory they are in, relative to the gallery's own.
 *
 * Relative because the gallery's directory is on the row above and repeating it
 * on every group heading pushes the part that differs off the end.
 */
export function groupByDirectory(
  files: ShellMediaFile[],
  galleryDirectory: string,
): { directory: string; label: string; files: ShellMediaFile[] }[] {
  const groups = new Map<string, ShellMediaFile[]>();
  for (const file of files) {
    const directory = file.ref.slice(0, file.ref.lastIndexOf("/")) || "/";
    const existing = groups.get(directory);
    if (existing) existing.push(file);
    else groups.set(directory, [file]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, groupFiles]) => ({
      directory,
      label: relativeDirectory(directory, galleryDirectory),
      files: groupFiles,
    }));
}

function relativeDirectory(
  directory: string,
  galleryDirectory: string,
): string {
  if (directory === galleryDirectory) return "In this folder";

  const prefix = galleryDirectory.endsWith("/")
    ? galleryDirectory
    : `${galleryDirectory}/`;
  return directory.startsWith(prefix)
    ? directory.slice(prefix.length)
    : // Not under the gallery at all, so there is nothing to make it relative
      // to and the whole path is shown — as it is served, like everywhere else.
      servedPath(directory);
}
