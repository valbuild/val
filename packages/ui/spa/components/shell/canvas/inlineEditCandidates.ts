import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
} from "@valbuild/core";
import {
  isInlineRichText,
  type InlineEditCandidate,
} from "@valbuild/shared/internal";
import { resolvePatchPath } from "../../../resolvePatchPath";

/**
 * A field the page is offered for editing in place, as the Studio knows it:
 * the candidate the page is sent, under the path the Studio writes it at.
 */
export type CanvasInlineEditCandidate = InlineEditCandidate & {
  path: SourcePath;
};

/**
 * Which of the paths on a clicked element can be edited ON the page, and
 * what each holds now.
 *
 * A string and a richtext, and nothing else: they are the two a caret means
 * something in. A number, an image, a date or a route is still opened in
 * the Studio's own column, where its control is.
 *
 * Not offered, either: a field that is `readonly` or inside something that
 * is, one whose value is `null` (there is nothing on the page to put a
 * caret in, and typing would have to decide what an empty string means),
 * and one that does not resolve -- the page can be a build ahead of or
 * behind the Studio, and a path that is not there is opened the usual way,
 * which says why.
 *
 * The value goes with it because the PAGE decides whether an element shows
 * the field and nothing else (`canEditInline`), and it can only do that by
 * comparing what the element holds with what the field does.
 */
export function inlineEditCandidates(
  paths: readonly SourcePath[],
  sources: Record<ModuleFilePath, Source>,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): CanvasInlineEditCandidate[] {
  if (schemas === undefined) return [];
  const candidates: CanvasInlineEditCandidate[] = [];
  for (const path of paths) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    if (!modulePath) continue;
    const resolved = resolvePatchPath(
      Internal.splitModulePath(modulePath),
      schemas[moduleFilePath],
      sources[moduleFilePath],
    );
    if (!resolved.success) continue;
    if (resolved.allResolved.some((part) => part.schema.readonly === true)) {
      continue;
    }
    const { schema, source } = resolved;
    if (schema.type === "string" && typeof source === "string") {
      candidates.push({
        path,
        kind: "string",
        value: source,
        ...(schema.multiline === true ? { multiline: true } : {}),
      });
    } else if (schema.type === "richtext" && isInlineRichText(source)) {
      candidates.push({ path, kind: "richtext", value: source });
    }
  }
  return candidates;
}
