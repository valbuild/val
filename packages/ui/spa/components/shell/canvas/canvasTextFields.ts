import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
} from "@valbuild/core";
import { resolvePatchPath } from "../../../resolvePatchPath";
import {
  type CanvasInlineEditCandidate,
  inlineEditCandidates,
} from "./inlineEditCandidates";

/**
 * What the page is told of its texts ahead of a click (`textFields` in the
 * canvas protocol). The page has no schemas, so only the Studio can say which
 * of the paths it reported are a string or a richtext.
 */
export type CanvasTextFields = {
  /** Select & edit is on, and fields may be written. */
  editing: boolean;
  /**
   * In Select & edit, what can be typed in on the page and what each holds:
   * a click on an element that shows one of them starts the edit in the
   * click itself, rather than a round trip later. Empty otherwise.
   */
  editable: CanvasInlineEditCandidate[];
  /**
   * The strings and richtexts that are empty now: kept pointable on the
   * page while Select is on, in either mode.
   */
  empty: SourcePath[];
};

/** Said while Select is off: nothing is picked, so nothing is needed. */
export const NO_CANVAS_TEXT_FIELDS: CanvasTextFields = {
  editing: false,
  editable: [],
  empty: [],
};

export function canvasTextFields(
  paths: readonly SourcePath[],
  sources: Record<ModuleFilePath, Source>,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
  editing: boolean,
): CanvasTextFields {
  if (schemas === undefined) return NO_CANVAS_TEXT_FIELDS;
  const empty: SourcePath[] = [];
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
    const { schema, source } = resolved;
    // `null` is not here: a field with no value is as often not rendered as
    // rendered empty, and growing it would be growing what the page left out.
    if (
      (schema.type === "string" &&
        typeof source === "string" &&
        source.trim() === "") ||
      (schema.type === "richtext" && isEmptyRichText(source))
    ) {
      empty.push(path);
    }
  }
  return {
    editing,
    editable: editing ? inlineEditCandidates(paths, sources, schemas) : [],
    empty,
  };
}

/** No text but white space, and no image: what an emptied richtext holds. */
function isEmptyRichText(source: unknown): boolean {
  if (!Array.isArray(source)) return false;
  return source.every(isEmptyNode);
}

function isEmptyNode(node: unknown): boolean {
  if (typeof node === "string") return node.trim() === "";
  if (typeof node !== "object" || node === null) return true;
  if (Reflect.get(node, "tag") === "img") return false;
  const children: unknown = Reflect.get(node, "children");
  return !Array.isArray(children) || children.every(isEmptyNode);
}
