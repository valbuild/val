import { useMemo } from "react";
import {
  Internal,
  type Json,
  type JsonObject,
  type MediaCollectionType,
  type SourcePath,
} from "@valbuild/core";
import { FileText } from "lucide-react";
import { getRefParts } from "@valbuild/shared/internal";
import { AnyField } from "../components/AnyField";
import {
  useSchemaAtPath,
  useSourceAtPath,
} from "../components/ValFieldProvider";
import { HotspotMarker } from "../components/fields/HotspotMarker";
import { useMediaUrl } from "../utils/mediaUrl";

/**
 * Which kind of gallery `path` is an ENTRY of, or null when it is not one.
 *
 * An `s.imagedir()` / `s.filedir()` / `s.videodir()` module is a record keyed
 * by file path, and its item schema is the file's METADATA — width, height,
 * mime type, alt. Rendered as an ordinary field, an added image came out as
 * those four values and no picture, which is the one thing a reader opened the
 * compare dialog to look at. So the entry is recognised by its PARENT, the
 * record that carries `mediaType`, and drawn as the file it describes.
 */
export function useMediaEntryKind(
  path: SourcePath,
): MediaCollectionType | null {
  const parent = useMemo(() => parentOf(path), [path]);
  // A hook is not skipped for a path with no parent: it asks about itself.
  const parentSchema = useSchemaAtPath(parent ?? path);
  if (parent === null || parentSchema.status !== "success") return null;
  const schema = parentSchema.data;
  return schema.type === "record" && schema.mediaType !== undefined
    ? schema.mediaType
    : null;
}

function parentOf(path: SourcePath): SourcePath | null {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  if (segments.length === 0) return null;
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath(segments.slice(0, -1)),
  );
}

/**
 * One gallery entry, as the file it is: the picture for an image, the file
 * name for anything else, then what the gallery knows about it.
 *
 * `side` decides the URL. The "after" side may be a file uploaded in this
 * publish, whose bytes are still in a patch, so it goes through `useMediaUrl`
 * like every other draft file in the Studio. The "before" side is published
 * content by definition, so it never borrows a draft's patch id — a removed
 * file is still served from where it was published until the removal ships.
 */
export function CompareMediaEntry({
  path,
  side,
  mediaType,
}: {
  path: SourcePath;
  side: "before" | "after";
  mediaType: MediaCollectionType;
}) {
  const ref = useMemo(() => refOf(path), [path]);
  const source = useSourceAtPath(path);
  const draftUrl = useMediaUrl(ref);
  const url =
    side === "after"
      ? (draftUrl ?? undefined)
      : Internal.mediaUrl({ path: ref });
  const metadata =
    source.status === "success" && isJsonObject(source.data)
      ? source.data
      : null;
  const hotspot = hotspotOf(metadata?.hotspot);
  const { filename } = getRefParts(ref);
  const facts = [
    typeof metadata?.width === "number" && typeof metadata?.height === "number"
      ? `${metadata.width}×${metadata.height}`
      : null,
    typeof metadata?.mimeType === "string" ? metadata.mimeType : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {mediaType === "images" ? (
        <div className="relative w-fit max-w-full overflow-hidden rounded border border-border-primary bg-bg-secondary">
          <img
            src={url}
            alt={typeof metadata?.alt === "string" ? metadata.alt : filename}
            draggable={false}
            className="block max-h-48 max-w-full object-contain"
          />
          {hotspot && <HotspotMarker hotspot={hotspot} size="sm" />}
        </div>
      ) : null}
      <div className="min-w-0 text-xs">
        <div
          className="flex min-w-0 items-center gap-1.5 text-fg-primary"
          title={ref}
        >
          {mediaType !== "images" && (
            <FileText
              size={14}
              className="shrink-0 text-fg-secondary"
              aria-hidden
            />
          )}
          <span className="truncate">{filename}</span>
        </div>
        {facts.length > 0 && (
          <div className="truncate text-fg-tertiary">{facts.join(" · ")}</div>
        )}
      </div>
      <MediaEntryAlt path={path} />
    </div>
  );
}

/**
 * The alt text, as the field it is — through `AnyField`, so a value that is
 * null or fails validation reads the way it does everywhere else.
 */
function MediaEntryAlt({ path }: { path: SourcePath }) {
  const altPath = Internal.createValPathOfItem(path, "alt");
  const schema = useSchemaAtPath(altPath ?? path);
  if (altPath === undefined || schema.status !== "success") return null;
  return (
    <div className="min-w-0">
      <div className="text-xs text-fg-tertiary">Alt text</div>
      <AnyField
        path={altPath}
        schema={schema.data}
        readonly
        compact
        inline
        errorDisplay="none"
      />
    </div>
  );
}

/** The record key, which for a gallery IS the file's path. */
function refOf(path: SourcePath): string {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  return segments[segments.length - 1] ?? "";
}

function hotspotOf(value: unknown): { x: number; y: number } | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("x" in value) || !("y" in value)) return null;
  const { x, y } = value;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
