import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { ShellSelection } from "./Shell";

/**
 * Whether the canvas is still showing the thing being edited.
 *
 * The canvas closes itself when the editor moves somewhere the page on it has
 * nothing to do with: a canvas showing a page you are no longer editing is
 * merely stale in the normal view, and in the fields view it is worse than that
 * — the editor column IS the page's fields, so the module you navigated to does
 * not appear at all and the navigation looks like it did nothing.
 *
 * ## "On the page" is not the same as "is a page"
 *
 * This used to be `selection.kind === "page"` and nothing else, which closed the
 * canvas on the one navigation that most obviously belongs to it: clicking an
 * element on the page it is showing. Most content on a real page lives outside
 * its route module — a footer, a settings record, an author — so picking any of
 * those resolved to a data module, which is not a page, which shut the canvas
 * and dropped you into a module editor. On a phone that is the entire workspace
 * rearranging itself in answer to a tap on some text.
 *
 * So the question is whether the editor is on content the CANVAS PAGE ITSELF
 * reported, which is exactly what its reported paths are a list of. Derived
 * rather than flagged: there is no "this navigation came from the canvas" bit to
 * set and forget, and a deep link into the footer while the canvas happens to be
 * showing a page that contains it is the same situation by a different route.
 */
export function canvasShowsEditedContent({
  selectionKind,
  editedPath,
  canvasModules,
}: {
  /** What the navigation resolved the route to, or `null` for no row. */
  selectionKind: ShellSelection["kind"] | null;
  /** The path the editor is on, or `null` when the route names none. */
  editedPath: SourcePath | null;
  /** The modules the page on the canvas reported content from. */
  canvasModules: ReadonlySet<ModuleFilePath>;
}): boolean {
  if (selectionKind === "page") return true;
  if (editedPath === null) return false;
  const [moduleFilePath] =
    Internal.splitModuleFilePathAndModulePath(editedPath);
  return canvasModules.has(moduleFilePath);
}

/**
 * The modules a page's reported paths belong to, as a stable key.
 *
 * A sorted string rather than the set itself, and that is load-bearing: the page
 * re-reports its elements whenever anything on it moves, so the path list is a
 * fresh array several times a second while the canvas is being scrolled. Keyed
 * on the array, everything downstream recomputes constantly and an effect that
 * depends on it runs constantly; keyed on what it MEANS, it changes when the
 * answer changes.
 */
export function canvasModulesKey(
  paths: readonly SourcePath[] | undefined,
): string {
  const modules = new Set<string>();
  for (const path of paths ?? []) {
    modules.add(Internal.splitModuleFilePathAndModulePath(path)[0]);
  }
  return Array.from(modules).sort().join("\n");
}

/** The set {@link canvasModulesKey} stands for. */
export function canvasModulesFromKey(key: string): ReadonlySet<ModuleFilePath> {
  return new Set(key === "" ? [] : (key.split("\n") as ModuleFilePath[]));
}
