import type { JSONValue } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";

/**
 * The Source each staged module file declares, read from its text: what a
 * staging sends content beside the files (`POST /proposals/:name/files`,
 * `modules`), so the proposal's Source moves with its code.
 *
 * A proposal's address serves a module's Source from what the proposal has
 * SAVED, over the site's, over the build -- never from the text. A save writes
 * both, so they agree. A staging wrote only the text, so after the design
 * tab's `create_patch` added a button to a module, its text and its build had
 * the button and the Source the server served and saved did not. The Studio,
 * lined up with that Source, could not apply an edit into the new button: the
 * canvas showed it, and then it was gone.
 *
 * Only what can be read without running anything: a `c.define(...)` whose
 * Source is a literal, a `.jsonValues()` record's entries as the markers its
 * stored Source holds (`evaluateModuleSource`) -- so an entry the design tab
 * adds is one the proposal has. Anything else -- a Source built by code, a
 * file of shared schemas -- is left out, and content keeps the Source it has
 * for it, as before this existed.
 */
export async function stagedModuleSources(
  files: Record<string, string | null>,
): Promise<Record<string, JSONValue>> {
  const modules = Object.entries(files).flatMap(([path, text]) =>
    text !== null && /\.val\.(ts|js)$/.test(path) ? [{ path, text }] : [],
  );
  if (modules.length === 0) return {};
  // The compiler, loaded when a staging asks for it, as a save loads it.
  const { parseValFile, analyzeValModule, evaluateModuleSource } =
    await import("./patch/ts/publishKit");
  const sources: Record<string, JSONValue> = {};
  for (const { path, text } of modules) {
    try {
      const analysis = analyzeValModule(parseValFile(text));
      if (result.isErr(analysis)) continue;
      const source = evaluateModuleSource(analysis.value.source);
      if (result.isErr(source)) continue;
      sources[`/${path.replace(/^\/+/, "")}`] = source.value;
    } catch {
      // No `c.define` at all (`analyzeValModule` throws): code, not a module.
      continue;
    }
  }
  return sources;
}
