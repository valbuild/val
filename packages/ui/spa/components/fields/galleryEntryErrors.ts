import { Internal, type SourcePath } from "@valbuild/core";

/**
 * The validation errors at or inside each entry of the gallery at `path`, by
 * the entry's key, with those about its description (`alt`) apart.
 */
export function validationErrorsByEntry(
  path: SourcePath,
  errors: Record<string, { message: string }[]> | null | undefined,
): Map<string, { entry: string[]; description: string[] }> {
  const byRef = new Map<string, { entry: string[]; description: string[] }>();
  if (!errors) return byRef;
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const galleryPath = Internal.splitModulePath(modulePath);
  for (const [errPath, errs] of Object.entries(errors)) {
    const [errModule, errModulePath] =
      Internal.splitModuleFilePathAndModulePath(errPath as SourcePath);
    if (errModule !== moduleFilePath) continue;
    const segments = Internal.splitModulePath(errModulePath);
    if (
      segments.length <= galleryPath.length ||
      !galleryPath.every((segment, i) => segments[i] === segment)
    ) {
      continue;
    }
    const ref = segments[galleryPath.length];
    let entry = byRef.get(ref);
    if (entry === undefined) {
      entry = { entry: [], description: [] };
      byRef.set(ref, entry);
    }
    const isDescription =
      segments.length === galleryPath.length + 2 &&
      segments[galleryPath.length + 1] === "alt";
    (isDescription ? entry.description : entry.entry).push(
      ...errs.map((err) => err.message),
    );
  }
  return byRef;
}
