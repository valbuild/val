import type { SelectorSource, ValModule, ValModules } from "@valbuild/core";
import { findValModule } from "@valbuild/react/internal";

/** What `unstable_fetchValPreviewSource` returns; serializable, for a loader. */
export type ValPreviewSource =
  /**
   * The content as JSON text: a server function's result has to be
   * serializable, and a module's content is typed per module by the app, so
   * text is what can be promised. The edit tags are characters in the
   * strings, and survive it.
   */
  | { status: "ok"; sourcePath: string; moduleJson: string }
  | { status: "error"; message: string };

/**
 * EXPERIMENTAL: the content of the module `sourcePath` is in, as the app reads
 * it - for `Unstable_ValComponentPreview`, which renders the value at the path
 * with its component.
 *
 * Call it from a server function: it reads with the app's own `fetchVal`, so
 * an editor in draft mode gets the draft, with edit tags.
 *
 * The whole module rather than the value at the path, because which schema the
 * path ends in can depend on the content along the way (a union's variant), and
 * the browser has to walk it to find the component.
 */
export async function unstable_fetchValPreviewSource({
  valModules,
  fetchVal,
  sourcePath,
}: {
  valModules: ValModules;
  fetchVal: (module: ValModule<SelectorSource>) => Promise<unknown>;
  sourcePath: string;
}): Promise<ValPreviewSource> {
  const valModule = await findValModule(valModules, sourcePath);
  if (!valModule) {
    return {
      status: "error",
      message: `No module for '${sourcePath}' in val.modules.`,
    };
  }
  return {
    status: "ok",
    sourcePath,
    moduleJson: JSON.stringify(await fetchVal(valModule)),
  };
}
