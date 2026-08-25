import {
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderSearch,
  Upload,
  X,
} from "lucide-react";
import { Section, SecondaryButton } from "./ImageField";
import { fileTypeLabel, formatBytes } from "./formatBytes";
import { FileEntry, MediaFieldSource } from "./types";

export type FileFieldProps = {
  value: FileEntry | null;
  source: MediaFieldSource;
  onClear: () => void;
  onBrowse: () => void;
  onUpload: () => void;
  onOpen: () => void;
  onDownload: () => void;
  sourcePath?: string;
  isDevMode?: boolean;
};

/**
 * A file field: which file, and the two things you do with one.
 *
 * Shorter than the image field on purpose. `s.file()` stores a reference and
 * a mime type and nothing else — no alt text, no focal point — so the design
 * has one job: make it obvious which file is attached and let you check it
 * without leaving the editor. Everything else about a file is a fact rather
 * than a decision, which is why the details are a read-only list.
 */
export function FileField({
  value,
  source,
  onClear,
  onBrowse,
  onUpload,
  onOpen,
  onDownload,
  sourcePath,
  isDevMode,
}: FileFieldProps) {
  const fromCollection = source.kind === "collection";

  if (value === null) {
    return (
      <div className="rounded-md border border-dashed border-border-float px-4 py-6 text-center">
        <FileText
          size={22}
          strokeWidth={1.25}
          className="mx-auto mb-3 text-fg-secondary-alt"
        />
        <p className="text-xs text-fg-primary">No file attached</p>
        <p className="mx-auto mt-1 max-w-[22rem] text-[0.6875rem] leading-relaxed text-fg-secondary-alt">
          {fromCollection
            ? `Files for this field live in ${source.name}. Pick one, or add a new one to the collection first.`
            : "Drop a file here, or pick one that is already in the project."}
        </p>
        <div className="mt-3 flex justify-center gap-1.5">
          {fromCollection ? (
            <SecondaryButton icon={FolderSearch} onClick={onBrowse}>
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

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <FileGlyph mimeType={value.mimeType} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg-primary">
                {value.name}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-fg-secondary-alt">
                {formatBytes(value.size)} · {value.mimeType}
              </p>
            </div>
            <button
              type="button"
              aria-label="Remove file"
              onClick={onClear}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-secondary-alt hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <SecondaryButton icon={ExternalLink} onClick={onOpen}>
              Open
            </SecondaryButton>
            <SecondaryButton icon={Download} onClick={onDownload}>
              Download
            </SecondaryButton>
            {fromCollection ? (
              <SecondaryButton icon={FolderSearch} onClick={onBrowse}>
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

      <Section label="Details">
        <dl className="divide-y divide-border-float rounded-md border border-border-float">
          <DetailRow label="Type" value={value.mimeType} />
          <DetailRow label="Size" value={formatBytes(value.size)} />
          <DetailRow label="Path" value={value.ref} mono />
          {fromCollection && (
            <DetailRow label="Collection" value={source.moduleFilePath} mono />
          )}
        </dl>
      </Section>

      {isDevMode && sourcePath && (
        <p className="font-mono text-[0.6875rem] text-fg-secondary-alt">
          {sourcePath}
        </p>
      )}
    </div>
  );
}

/** The tile that stands in for a file with no thumbnail. */
export function FileGlyph({
  mimeType,
  className,
}: {
  mimeType: string;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        "grid h-[4.5rem] w-[7.5rem] shrink-0 place-items-center rounded-md border border-border-float bg-bg-float-raised"
      }
    >
      <span className="text-[0.6875rem] font-semibold tracking-wide text-fg-secondary">
        {fileTypeLabel(mimeType)}
      </span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <dt className="w-20 shrink-0 text-[0.6875rem] text-fg-secondary-alt">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "min-w-0 break-all font-mono text-[0.6875rem] text-fg-secondary"
            : "min-w-0 break-all text-[0.6875rem] text-fg-primary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
