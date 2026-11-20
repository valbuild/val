import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
} from "@valbuild/core";
import {
  forEachRichTextImage,
  SESSION_MEDIA_PREFIX,
} from "@valbuild/shared/internal";
import { useMemo } from "react";
import {
  useAllSources,
  useFilePatchIds,
  useSchemas,
} from "../ValFieldProvider";
import { isGallerySchema } from "../NavMenu/media";
import { traverseSchemas } from "../traverseSchemas";
import { isPageModule } from "../../utils/pageRoutes";
import type {
  SketchMediaLibrary,
  SketchMediaOption,
} from "./SketchpadMediaPicker";
import {
  useSketchpadsSnapshot,
  type SessionImage,
  type SketchpadsState,
} from "./SketchpadsState";

/**
 * What a Sketchpad's box may show in this project (`SketchMediaLibrary`),
 * read from the Studio's schemas and sources: the galleries' entries, the
 * images the site's content uses now, and the images put in the assistant's
 * session from this tab. Without `upload`, which the chat supplies.
 */
export function sketchMediaLibraryOf(input: {
  schemas: Readonly<Record<ModuleFilePath, SerializedSchema>>;
  sources: Readonly<Record<ModuleFilePath, Json>>;
  /** `useFilePatchIds()`: what an upload that is not published is served by. */
  filePatchIds: ReadonlyMap<string, string>;
  sessionImages: readonly SessionImage[];
}): Omit<SketchMediaLibrary, "upload"> {
  const { schemas, sources, filePatchIds } = input;
  const urlOf = (path: string) => {
    const patchId = filePatchIds.get(path);
    return Internal.mediaUrl({
      path,
      ...(patchId ? { patch_id: patchId } : {}),
    });
  };

  const galleries: SketchMediaLibrary["galleries"] = [];
  const galleryPaths = new Set<string>();
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    // A hidden gallery is out of the nav, not out of the project: a field
    // can still pick from it, and so can a box.
    if (!isGallerySchema(schema)) {
      continue;
    }
    galleryPaths.add(moduleFilePath);
    const type =
      schema.mediaType === "images"
        ? "image"
        : schema.mediaType === "videos"
          ? "video"
          : null;
    const source = sources[moduleFilePath];
    if (type === null || !isObject(source)) {
      continue;
    }
    const items: SketchMediaOption[] = Object.entries(source).map(
      ([path, entry]) => {
        const alt = isObject(entry) ? entry.alt : undefined;
        return {
          src: path,
          url: urlOf(path),
          type,
          label: typeof alt === "string" && alt !== "" ? alt : fileName(path),
        };
      },
    );
    galleries.push({ name: schema.dir ?? moduleFilePath, items });
  }
  galleries.sort((a, b) => a.name.localeCompare(b.name));

  // What the content uses now, where it uses it: once each, at the first
  // place it is used.
  const site = new Map<string, SketchMediaOption>();
  const contentSchemas: Record<ModuleFilePath, SerializedSchema> = {};
  const contentSources: Record<ModuleFilePath, Source> = {};
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    if (
      galleryPaths.has(moduleFilePath) ||
      isGallerySchema(schemas[moduleFilePath])
    ) {
      continue;
    }
    contentSchemas[moduleFilePath] = schemas[moduleFilePath];
    contentSources[moduleFilePath] = sources[moduleFilePath];
  }
  const addSite = (
    sourcePath: SourcePath,
    type: "image" | "video",
    value: unknown,
  ) => {
    if (!isObject(value) || typeof value.path !== "string") {
      return;
    }
    const path = value.path;
    if (site.has(path)) {
      return;
    }
    const alt = value.alt;
    site.set(path, {
      src: path,
      url: urlOf(path),
      type,
      label: typeof alt === "string" && alt !== "" ? alt : fileName(path),
      detail: whereIs(sourcePath, schemas),
    });
  };
  traverseSchemas(
    contentSchemas,
    contentSources,
    (sourcePath, schema, source) => {
      if (schema.type === "image" || schema.type === "video") {
        addSite(sourcePath, schema.type, source);
      } else if (schema.type === "richtext") {
        // An image in rich text is on the site as much as one in a field.
        forEachRichTextImage(sourcePath, source, (srcPath, src) =>
          addSite(srcPath, "image", src),
        );
      }
    },
  );

  const session: SketchMediaOption[] = input.sessionImages.map((image) => ({
    src: `${SESSION_MEDIA_PREFIX}${image.key}`,
    url: image.url,
    type: "image",
    label: image.name,
    detail: "Uploaded to this chat",
  }));

  return { galleries, site: Array.from(site.values()), session };
}

/**
 * Where a value is, in words: the page's route and the field for a page,
 * the module's file and the field for anything else. "/about › hero".
 */
function whereIs(
  sourcePath: SourcePath,
  schemas: Readonly<Record<ModuleFilePath, SerializedSchema>>,
): string {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  const field = [...segments].reverse().find((s) => !/^\d+$/.test(s));
  if (isPageModule(schemas[moduleFilePath]) && segments.length > 0) {
    return field && field !== segments[0]
      ? `${segments[0]} › ${field}`
      : segments[0];
  }
  const file = fileName(moduleFilePath).replace(/\.val\.(ts|js|json)$/, "");
  return field ? `${file} › ${field}` : file;
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a box may name `src`: an image of a gallery or of the content, or
 * one in the chat (`session:` -- any of them, since only the server has the
 * list, and it checks when the image is used).
 */
export function knownSketchMedia(
  schemas: Readonly<Record<ModuleFilePath, SerializedSchema>>,
  sources: Readonly<Record<ModuleFilePath, Json>>,
): (src: string) => boolean {
  const library = sketchMediaLibraryOf({
    schemas,
    sources,
    filePatchIds: new Map(),
    sessionImages: [],
  });
  const known = new Set(
    [...library.galleries.flatMap((g) => g.items), ...library.site].map(
      (option) => option.src,
    ),
  );
  return (src) => known.has(src) || src.startsWith(SESSION_MEDIA_PREFIX);
}

/**
 * `sketchMediaLibraryOf` for the Studio, with the chat's upload. The same
 * object while what it lists is the same, so a keystroke in a field does
 * not redraw every box of the sketch.
 */
export function useSketchMediaLibrary(
  state: SketchpadsState,
): SketchMediaLibrary | undefined {
  const schemas = useSchemas();
  const sources = useAllSources();
  const filePatchIds = useFilePatchIds();
  const snapshot = useSketchpadsSnapshot(state);
  const uploader = state.getUploader();
  const computed = useMemo(
    () =>
      schemas.status === "success"
        ? sketchMediaLibraryOf({
            schemas: schemas.data,
            sources,
            filePatchIds,
            sessionImages: snapshot.sessionImages,
          })
        : null,
    [schemas, sources, filePatchIds, snapshot.sessionImages],
  );
  const key = computed ? JSON.stringify(computed) : null;
  // `key` is `computed`, by value: the same object while what it lists is.
  const stable = useMemo(() => computed, [key]);
  return useMemo(() => {
    if (!stable) {
      return undefined;
    }
    if (!uploader) {
      return stable;
    }
    return {
      ...stable,
      upload: async (file: File): Promise<SketchMediaOption | null> => {
        if (!file.type.startsWith("image/")) {
          throw new Error(
            `"${file.name}" is not an image. A box takes images from the chat.`,
          );
        }
        const { key } = await uploader(file);
        return {
          src: `${SESSION_MEDIA_PREFIX}${key}`,
          url: URL.createObjectURL(file),
          type: "image",
          label: file.name,
          detail: "Uploaded to this chat",
        };
      },
    };
  }, [stable, uploader]);
}
