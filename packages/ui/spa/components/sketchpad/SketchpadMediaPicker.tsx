import { Check, ImagePlus, Search, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../designSystem/tabs";
import { useValPortal } from "../ValPortalProvider";

/** One file a box can show: what the sketch names it by, and where it loads. */
export type SketchMediaOption = {
  /** What the sketch text says: the content's `path`, or `session:<key>`. */
  src: string;
  /** Where the browser loads it from. */
  url: string;
  type: "image" | "video";
  /** What a person calls it: the alt text, the file name. */
  label: string;
  /** Where it is: "Home › hero", or the gallery's name. */
  detail?: string;
};

/**
 * Every file a sketch may name, from the three places one can come from.
 * A sketch names nothing else, so the page built from it uses a file that
 * exists: an image from a gallery, an image already on the site (to use it
 * again, or move it), or one uploaded to the assistant's session -- which
 * the assistant makes a real image of the site when it builds the page.
 */
export type SketchMediaLibrary = {
  /** `s.imagedir()` and `s.filedir()` modules, by name. */
  galleries: { name: string; items: SketchMediaOption[] }[];
  /** Images in the site's content now, with where each one is. */
  site: SketchMediaOption[];
  /** Images uploaded to the assistant's session. */
  session: SketchMediaOption[];
  /**
   * Uploads a file to the assistant's session and resolves to it. Rejects
   * with what went wrong, in words for the person. Absent, nothing can be
   * uploaded here.
   */
  upload?: (file: File) => Promise<SketchMediaOption | null>;
};

type Source = "galleries" | "site" | "session";

/**
 * The image picker of a Sketchpad's box: the galleries, the site's images and
 * this chat's uploads, with a search over all of them, and Upload, which puts
 * a new file in the chat first and then in the box.
 */
export function SketchpadMediaPicker({
  open,
  library,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  library: SketchMediaLibrary;
  /** The `src` the box shows now, marked in the grid. */
  current: string | null;
  onPick: (option: SketchMediaOption) => void;
  onClose: () => void;
}) {
  const portal = useValPortal();
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Opens where the box's image is; else on the first place that has any.
  const initial: Source =
    current !== null && library.site.some((o) => o.src === current)
      ? "site"
      : current !== null && library.session.some((o) => o.src === current)
        ? "session"
        : current !== null &&
            library.galleries.some((g) =>
              g.items.some((o) => o.src === current),
            )
          ? "galleries"
          : library.galleries.some((g) => g.items.length > 0)
            ? "galleries"
            : library.site.length > 0
              ? "site"
              : "session";
  const [tab, setTab] = useState<Source>(initial);

  const matches = (option: SketchMediaOption) => {
    const q = query.trim().toLowerCase();
    return (
      q === "" ||
      option.label.toLowerCase().includes(q) ||
      (option.detail ?? "").toLowerCase().includes(q) ||
      option.src.toLowerCase().includes(q)
    );
  };
  const counts = useMemo(
    () => ({
      galleries: library.galleries.reduce((n, g) => n + g.items.length, 0),
      site: library.site.length,
      session: library.session.length,
    }),
    [library],
  );

  const [uploadError, setUploadError] = useState<{
    file: File;
    message: string;
  } | null>(null);
  const upload = async (file: File) => {
    if (!library.upload) return;
    setUploading(true);
    setUploadError(null);
    try {
      const option = await library.upload(file);
      if (option) onPick(option);
    } catch (error) {
      setUploadError({
        file,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        container={portal}
        className="flex max-h-[85vh] max-w-3xl flex-col gap-3 p-4"
      >
        <div className="flex items-start justify-between gap-3 pr-8">
          <div>
            <DialogTitle className="text-base">Pick an image</DialogTitle>
            <DialogDescription className="text-xs text-fg-secondary">
              Choose one from a gallery or the site, or upload a new one.
            </DialogDescription>
          </div>
          {library.upload && (
            <>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
                className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border-primary px-2.5 text-xs font-medium hover:bg-bg-secondary disabled:opacity-60"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload"}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </>
          )}
        </div>
        {uploadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-bg-error-secondary px-3 py-1.5 text-xs text-fg-error-secondary"
          >
            <span>
              “{uploadError.file.name}” was not uploaded. {uploadError.message}
            </span>
            <button
              type="button"
              disabled={uploading}
              onClick={() => void upload(uploadError.file)}
              className="cursor-pointer font-medium underline"
            >
              Try again
            </button>
          </div>
        )}
        <label className="flex items-center gap-2 rounded-md border border-border-primary px-2.5">
          <Search className="h-3.5 w-3.5 text-fg-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, alt text or where it is"
            aria-label="Search images"
            className="h-8 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (
              value === "galleries" ||
              value === "site" ||
              value === "session"
            )
              setTab(value);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="self-start">
            <TabsTrigger value="galleries">
              Galleries · {counts.galleries}
            </TabsTrigger>
            <TabsTrigger value="site">On the site · {counts.site}</TabsTrigger>
            <TabsTrigger value="session">
              This chat · {counts.session}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="galleries"
            className="min-h-0 flex-1 overflow-auto"
          >
            {library.galleries.length === 0 ? (
              <Empty>This site has no galleries.</Empty>
            ) : (
              library.galleries.map((gallery) => (
                <section key={gallery.name} className="mb-4">
                  <h3 className="mb-2 text-xs font-medium text-fg-secondary">
                    {gallery.name}
                  </h3>
                  <Grid
                    options={gallery.items.filter(matches)}
                    current={current}
                    onPick={onPick}
                  />
                </section>
              ))
            )}
          </TabsContent>
          <TabsContent value="site" className="min-h-0 flex-1 overflow-auto">
            {library.site.length === 0 ? (
              <Empty>No images on the site yet.</Empty>
            ) : (
              <Grid
                options={library.site.filter(matches)}
                current={current}
                onPick={onPick}
              />
            )}
          </TabsContent>
          <TabsContent value="session" className="min-h-0 flex-1 overflow-auto">
            {library.session.length === 0 ? (
              <Empty>
                Nothing uploaded in this chat yet.
                {library.upload && (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="ml-1 cursor-pointer font-medium underline"
                  >
                    Upload one
                  </button>
                )}
              </Empty>
            ) : (
              <Grid
                options={library.session.filter(matches)}
                current={current}
                onPick={onPick}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Grid({
  options,
  current,
  onPick,
}: {
  options: SketchMediaOption[];
  current: string | null;
  onPick: (option: SketchMediaOption) => void;
}) {
  if (options.length === 0) {
    return <Empty>Nothing here matches the search.</Empty>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {options.map((option) => {
        const picked = option.src === current;
        return (
          <li key={option.src}>
            <button
              type="button"
              onClick={() => onPick(option)}
              aria-pressed={picked}
              title={option.src}
              className={cn(
                "group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-md border text-left",
                picked
                  ? "border-border-brand-primary ring-2 ring-border-brand-primary"
                  : "border-border-primary hover:border-border-focus",
              )}
            >
              <span className="flex aspect-[4/3] items-center justify-center bg-bg-tertiary">
                {option.type === "video" ? (
                  <video
                    src={option.url}
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={option.url}
                    alt={option.label}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="truncate px-2 pt-1.5 text-xs font-medium">
                {option.label}
              </span>
              <span className="truncate px-2 pb-1.5 text-[11px] text-fg-tertiary">
                {option.detail ?? option.src}
              </span>
              {picked && (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-brand-primary text-fg-brand-primary">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-fg-secondary">
      <ImagePlus className="h-4 w-4" />
      <span>{children}</span>
    </p>
  );
}
