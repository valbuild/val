import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "./designSystem/cn";

/**
 * A font file, drawn in itself.
 *
 * The file is loaded with the `FontFace` API under a family name of our own and
 * added to `document.fonts`. That is the one way to use a font inside the
 * Studio's shadow root: an `@font-face` rule written IN a shadow tree is ignored
 * by every browser, while a face in the document's font set is visible to all
 * of its trees. A family of our own, because the font's real family name is in
 * its `name` table, which for a WOFF2 is behind a Brotli stream the browser
 * will not decompress for us — and it does not matter what it is called.
 */

type FontState =
  | { status: "loading" }
  | { status: "ready"; family: string }
  | { status: "error" };

/**
 * One load per URL for the life of the page. Faces are added to the document
 * and never removed: a gallery's tiles mount and unmount as they scroll, and
 * each remount would otherwise download the font again.
 */
const loaded = new Map<string, Promise<string>>();
let nextFamily = 0;

function loadFont(url: string): Promise<string> {
  const existing = loaded.get(url);
  if (existing) {
    return existing;
  }
  const family = `val-font-preview-${nextFamily++}`;
  const promise = (async () => {
    // A quote or a backslash in the URL would end the `url("…")` early.
    const cssUrl = url.replace(/["\\]/g, (ch) => encodeURIComponent(ch));
    const face = new FontFace(family, `url("${cssUrl}")`);
    await face.load();
    document.fonts.add(face);
    return family;
  })();
  // A failure is not cached: the file may be a draft whose upload is still
  // landing, and the next mount should try again. Nor is a data URL — the
  // bytes of a file mid-upload — which would keep the whole file as a key.
  if (!url.startsWith("data:")) {
    promise.catch(() => loaded.delete(url));
    loaded.set(url, promise);
  }
  return promise;
}

/** The family to draw `url` with, once the browser has it. */
export function useFontFamily(url: string | null): FontState {
  const [state, setState] = useState<FontState>({ status: "loading" });
  useEffect(() => {
    if (
      !url ||
      typeof FontFace === "undefined" ||
      typeof document === "undefined" ||
      !document.fonts
    ) {
      setState({ status: "error" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    loadFont(url).then(
      (family) => {
        if (!cancelled) setState({ status: "ready", family });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

const PANGRAM = "The quick brown fox jumps over the lazy dog";
const SIZES = [32, 20, 14];

/**
 * A specimen of the font at `url`:
 *
 * - `tile` — "Aa", filling a gallery tile or a field's thumbnail;
 * - `inspector` — the glyphs a font is chosen by, a sentence at three sizes,
 *   and a box to type your own words into, since the words a font has to set
 *   are the ones the site will use, not a pangram.
 *
 * Falls back to a file icon when the browser cannot load it — a truncated
 * upload, a format this browser does not read, or a font collection, which
 * `FontFace` does not take.
 */
export function FontSpecimen({
  url,
  variant,
  tileFontSize = "2.5rem",
  className,
}: {
  url: string;
  variant: "tile" | "inspector";
  /** How large the tile's "Aa" is set: it fills a gallery tile by default. */
  tileFontSize?: string;
  className?: string;
}) {
  const font = useFontFamily(url);
  const [sample, setSample] = useState("");

  if (font.status !== "ready") {
    return (
      <span
        className={cn(
          "grid h-full w-full place-items-center text-fg-secondary-alt",
          className,
        )}
        title={font.status === "error" ? "Could not load the font" : undefined}
      >
        {font.status === "loading" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <FileText size={variant === "tile" ? 16 : 40} strokeWidth={1.25} />
        )}
      </span>
    );
  }

  const fontFamily = `"${font.family}", system-ui`;
  if (variant === "tile") {
    return (
      <span
        aria-hidden
        className={cn(
          "grid h-full w-full place-items-center overflow-hidden text-fg-primary",
          className,
        )}
        style={{ fontFamily, fontSize: tileFontSize, lineHeight: 1 }}
      >
        Aa
      </span>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 overflow-hidden rounded-md bg-bg-tertiary p-4 text-fg-primary",
        className,
      )}
      data-font-preview={font.family}
    >
      <div style={{ fontFamily }} className="flex flex-col gap-2">
        <p style={{ fontSize: 56, lineHeight: 1 }}>Aa Gg</p>
        <p className="break-words text-base leading-snug">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
          <br />
          abcdefghijklmnopqrstuvwxyz
          <br />
          0123456789 &amp;?!@(.,;:)
        </p>
        {SIZES.map((size) => (
          <p
            key={size}
            style={{ fontSize: size, lineHeight: 1.2 }}
            className="break-words"
          >
            {sample || PANGRAM}
          </p>
        ))}
      </div>
      <input
        type="text"
        value={sample}
        onChange={(ev) => setSample(ev.target.value)}
        placeholder="Type to preview…"
        aria-label="Preview text"
        className="h-8 rounded-md border border-border-primary bg-bg-primary px-2 text-sm text-fg-primary placeholder:text-fg-secondary-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      />
    </div>
  );
}
