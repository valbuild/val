import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { createService, filesOfVideo } from "@valbuild/server";
import { traverseSchemaSource } from "@valbuild/shared/internal";
import { glob } from "fast-glob";
import path from "path";
import { findAndEvalValConfigFile } from "./utils/evalValConfigFile";

export async function listUnusedFiles({ root }: { root?: string }) {
  const projectRoot = root ? path.resolve(root) : process.cwd();

  const valConfigFile = await findAndEvalValConfigFile(projectRoot);
  // Strip the leading "/" so it is relative to the project root (e.g. "public/val").
  const managedDir = (valConfigFile?.files?.directory ?? "/public/val").replace(
    /^\//,
    "",
  );

  const service = await createService(projectRoot);
  const registered = new Set<ModuleFilePath>(service.getModuleFilePaths());

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  const filesUsedByVal: string[] = [];
  async function pushFilesUsedByVal(file: string) {
    const moduleId = `/${file}` as ModuleFilePath; // TODO: check if this always works? (Windows?)
    if (!registered.has(moduleId)) {
      // Not registered in val.modules - skip (e.g. reusable schema fragments).
      return;
    }
    const valModule = await service.get(moduleId, "" as ModulePath, {
      validate: true,
    });
    // A video is found by walking the source, not by its validation errors:
    // unlike an image, a video with all its metadata reports none, so the
    // errors below would call every finished video unused. And a video names
    // more than its `path` — a poster, caption tracks, and a stream's
    // playlists and segments — which `filesOfVideo` is the one answer to.
    if (valModule.source !== undefined && valModule.schema) {
      traverseSchemaSource(
        valModule.source,
        valModule.schema,
        moduleId as string as SourcePath,
        ({ source, schema }) => {
          if (schema.type !== "video") {
            return;
          }
          for (const ref of filesOfVideo(source, { projectRoot })) {
            if (!Internal.isRemoteMediaPath(ref)) {
              filesUsedByVal.push(path.join(projectRoot, ...ref.split("/")));
            }
          }
        },
      );
    }
    // A media collection (`s.imageset()`, `s.fileset()`, `s.videoset()`) is
    // keyed by its files, and an entry that is fine reports no error either —
    // so, as for a video, they are found by walking the source. A video set's
    // stream holds every playlist and segment its master names.
    if (valModule.source !== undefined && valModule.schema) {
      forEachMediaCollection(
        valModule.source,
        valModule.schema,
        (entries, mediaType) => {
          for (const [key, entry] of Object.entries(entries)) {
            const refs =
              mediaType === "videos"
                ? filesOfVideo(
                    {
                      path: key,
                      mimeType:
                        isObject(entry) && typeof entry.mimeType === "string"
                          ? entry.mimeType
                          : undefined,
                    },
                    { projectRoot },
                  )
                : [key];
            for (const ref of refs) {
              if (!Internal.isRemoteMediaPath(ref)) {
                filesUsedByVal.push(path.join(projectRoot, ...ref.split("/")));
              }
            }
          }
        },
      );
    }
    // TODO: not sure using validation is the best way to do this, but it works currently.
    if (valModule.errors) {
      if (valModule.errors.validation) {
        for (const sourcePathS in valModule.errors.validation) {
          const sourcePath = sourcePathS as SourcePath;
          const validationError = valModule.errors.validation[sourcePath];
          for (const error of validationError) {
            const value = error.value;
            if (isFileRef(value)) {
              const absoluteFilePathUsedByVal = path.join(
                projectRoot,
                ...value.path.split("/"),
              );
              filesUsedByVal.push(absoluteFilePathUsedByVal);
            }
          }
        }
      }
    }
  }
  for (const file of valFiles) {
    await pushFilesUsedByVal(file);
  }

  const managedRoot = path.join(projectRoot, managedDir);
  const allFilesInManagedDir = await glob("**/*", {
    ignore: ["node_modules/**"],
    cwd: managedRoot,
  });
  for (const file of allFilesInManagedDir) {
    const absoluteFilePath = path.join(managedRoot, file);
    if (!filesUsedByVal.includes(absoluteFilePath)) {
      console.log(path.join(managedRoot, file));
    }
  }

  service.dispose();
  return;
}

/**
 * Whether a flagged validation value names a file.
 *
 * A `ValidationError` carries no schema, so the shape is all there is to go on —
 * the same heuristic this whole function documents as a TODO.
 */
function isFileRef(value: unknown): value is { path: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "path" in value &&
    typeof value.path === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every media collection in a module's source, with its entries.
 *
 * `traverseSchemaSource` visits leaves, and a collection is a record whose
 * KEYS are what matters, so it never shows up there.
 */
function forEachMediaCollection(
  source: unknown,
  schema: SerializedSchema,
  visit: (
    entries: Record<string, unknown>,
    mediaType: "files" | "images" | "videos",
  ) => void,
): void {
  if (schema.type === "record") {
    if (!isObject(source)) {
      return;
    }
    if (schema.mediaType) {
      visit(source, schema.mediaType);
      return;
    }
    for (const value of Object.values(source)) {
      forEachMediaCollection(value, schema.item, visit);
    }
  } else if (schema.type === "object") {
    if (!isObject(source)) {
      return;
    }
    for (const [key, item] of Object.entries(schema.items)) {
      forEachMediaCollection(source[key], item, visit);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(source)) {
      return;
    }
    for (const value of source) {
      forEachMediaCollection(value, schema.item, visit);
    }
  }
}
