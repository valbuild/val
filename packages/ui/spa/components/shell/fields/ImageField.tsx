import { useState } from "react";
import {
  FolderOpen,
  Image as ImageIcon,
  Images,
  Pencil,
  Upload,
  X,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { Checkbox } from "../../designSystem/checkbox";
import { HotspotPicker } from "./HotspotPicker";
import { formatBytes } from "./formatBytes";
import { ImageEntry, MediaFieldSource } from "./types";

export type ImageFieldProps = {
  /** The image, or null for an empty field. */
  value: ImageEntry | null;
  /** Where the file comes from, which decides what this field can edit. */
  source: MediaFieldSource;
  /**
   * The alt text the collection holds for this image.
   *
   * Only meaningful for a collection-backed field: the field stores its own
   * copy, so the two can differ, and an editor needs to be able to see that.
   */
  collectionAlt?: string | null;
  onChange: (value: ImageEntry) => void;
  onClear: () => void;
  onBrowse: () => void;
  onUpload: () => void;
  /** Shown when dev mode is on. */
  sourcePath?: string;
  isDevMode?: boolean;
};

const ALT_MAX = 125;

/**
 * An image field: the picture, what it is of, and where it should be looked
 * at when something crops it.
 *
 * The three questions are deliberately in that order and not in tabs. Alt
 * text is the one an editor is most likely to skip and the one a page is
 * least able to do without, so it sits directly under the file rather than
 * behind a disclosure.
 *
 * Whether the field owns its file or points into a collection changes what it
 * may edit, not how it looks — a collection-backed field can still override
 * the alt text for this one use, because "person looking at mountains" is a
 * description of the picture while "our founder, in Norway" is a description
 * of why it is on this page.
 */
export function ImageField({
  value,
  source,
  collectionAlt,
  onChange,
  onClear,
  onBrowse,
  onUpload,
  sourcePath,
  isDevMode,
}: ImageFieldProps) {
  const fromCollection = source.kind === "collection";
  const [overridesAlt, setOverridesAlt] = useState(
    () => fromCollection && value !== null && value.alt !== collectionAlt,
  );

  if (value === null) {
    return (
      <EmptyImageField
        source={source}
        onBrowse={onBrowse}
        onUpload={onUpload}
      />
    );
  }

  const effectiveAlt =
    fromCollection && !overridesAlt ? collectionAlt : value.alt;

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <div className="h-[4.5rem] w-[7.5rem] shrink-0 overflow-hidden rounded-md border border-border-float bg-bg-float-raised">
          <img
            src={value.url}
            alt={value.alt ?? ""}
            style={{
              objectPosition: value.hotspot
                ? `${value.hotspot.x * 100}% ${value.hotspot.y * 100}%`
                : undefined,
            }}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg-primary">
                {value.name}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-fg-secondary-alt">
                {value.width} × {value.height} · {formatBytes(value.size)} ·{" "}
                {value.mimeType}
              </p>
            </div>
            <button
              type="button"
              aria-label="Remove image"
              onClick={onClear}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-secondary-alt hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {fromCollection ? (
              <SecondaryButton icon={Images} onClick={onBrowse}>
                Choose from {source.name}
              </SecondaryButton>
            ) : (
              <>
                <SecondaryButton icon={Upload} onClick={onUpload}>
                  Replace
                </SecondaryButton>
                <SecondaryButton icon={FolderOpen} onClick={onBrowse}>
                  Browse library
                </SecondaryButton>
              </>
            )}
          </div>
        </div>
      </div>

      <Section
        label="Alt text"
        hint="What the image shows, for people who cannot see it."
      >
        {fromCollection && (
          <label className="mb-2 flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={overridesAlt}
              onCheckedChange={(checked) => {
                const next = checked === true;
                setOverridesAlt(next);
                // Turning the override off puts the collection's text back,
                // so the field stops disagreeing with the library the moment
                // you stop meaning to.
                if (!next) onChange({ ...value, alt: collectionAlt ?? null });
              }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-xs text-fg-primary">
                Override for this page
              </span>
              <span className="block text-[0.6875rem] text-fg-secondary-alt">
                {source.name} says “{collectionAlt ?? "nothing"}”.
              </span>
            </span>
          </label>
        )}
        <textarea
          value={effectiveAlt ?? ""}
          readOnly={fromCollection && !overridesAlt}
          maxLength={ALT_MAX}
          rows={2}
          placeholder="Person looking at mountains and lake"
          onChange={(event) => onChange({ ...value, alt: event.target.value })}
          className={cn(
            "w-full resize-none rounded-md border border-border-float bg-bg-surface px-3 py-2 text-xs text-fg-primary outline-none",
            "placeholder:text-fg-secondary-alt focus:border-border-primary",
            fromCollection && !overridesAlt && "text-fg-secondary",
          )}
        />
        <div className="mt-1.5 flex items-center gap-3">
          <span className="text-[0.6875rem] tabular-nums text-fg-secondary-alt">
            {(effectiveAlt ?? "").length} / {ALT_MAX}
          </span>
          {(!fromCollection || overridesAlt) && (
            <button
              type="button"
              onClick={() =>
                onChange({ ...value, alt: readableFilename(value.name) })
              }
              className="text-[0.6875rem] text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
            >
              Use the filename
            </button>
          )}
          {effectiveAlt === null ||
            (effectiveAlt === "" && (
              <span className="text-[0.6875rem] text-fg-error-on-surface">
                Missing
              </span>
            ))}
        </div>
      </Section>

      <Section
        label="Focal point"
        hint="The part that must stay in frame when the page crops this image."
      >
        <HotspotPicker
          url={value.url}
          alt={effectiveAlt ?? value.name}
          hotspot={value.hotspot}
          onChange={(hotspot) => onChange({ ...value, hotspot })}
        />
      </Section>

      {isDevMode && sourcePath && (
        <p className="font-mono text-[0.6875rem] text-fg-secondary-alt">
          {sourcePath}
        </p>
      )}
    </div>
  );
}

function EmptyImageField({
  source,
  onBrowse,
  onUpload,
}: {
  source: MediaFieldSource;
  onBrowse: () => void;
  onUpload: () => void;
}) {
  const fromCollection = source.kind === "collection";
  return (
    <div className="rounded-md border border-dashed border-border-float px-4 py-6 text-center">
      <ImageIcon
        size={22}
        strokeWidth={1.25}
        className="mx-auto mb-3 text-fg-secondary-alt"
      />
      <p className="text-xs text-fg-primary">
        {fromCollection ? "No image chosen" : "No image yet"}
      </p>
      <p className="mx-auto mt-1 max-w-[22rem] text-[0.6875rem] leading-relaxed text-fg-secondary-alt">
        {fromCollection
          ? `Images for this field live in ${source.name}. Pick one, or add a new one to the collection first.`
          : "Drop a file here, or pick one that is already in the project."}
      </p>
      <div className="mt-3 flex justify-center gap-1.5">
        {fromCollection ? (
          <SecondaryButton icon={Images} onClick={onBrowse}>
            Choose from {source.name}
          </SecondaryButton>
        ) : (
          <>
            <SecondaryButton icon={Upload} onClick={onUpload}>
              Upload
            </SecondaryButton>
            <SecondaryButton icon={FolderOpen} onClick={onBrowse}>
              Browse library
            </SecondaryButton>
          </>
        )}
      </div>
    </div>
  );
}

export function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-medium text-fg-primary">{label}</h3>
      {hint && (
        <p className="mb-2 mt-0.5 text-[0.6875rem] text-fg-secondary-alt">
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}

export function SecondaryButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof Pencil;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-float px-2.5 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

/**
 * A filename as a first draft of alt text.
 *
 * Val's filenames carry a content hash — `hero-mountains_a1b2c.jpg` — so the
 * hash and the extension come off before this is offered to anyone.
 */
export function readableFilename(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  const withoutHash = withoutExtension.replace(/_[0-9a-f]{5}$/, "");
  const words = withoutHash.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
