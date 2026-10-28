import { result } from "@valbuild/core/fp";
import { applyPatch, type Patch } from "@valbuild/core/patch";

/**
 * A module's file with a patch written into it: what a save does to a
 * `.val.ts`, for one file and one patch, with nothing pending around it.
 *
 * The design tab's `create_patch` (valbuild/home `docs/design-tab.md`): there
 * the assistant changes a proposal's code, and content it writes goes into the
 * module's file and is staged with the code -- so a field it just added can
 * be filled in the same change, and is built and rendered with it.
 *
 * Only the module's own file. A `.jsonValues()` entry lives in a `*.val.json`
 * of its own, which a save routes to op by op (`ValOps.prepare`); a patch that
 * reaches into one fails here, and the message says to write that file.
 */
export async function patchModuleText(
  text: string,
  patch: Patch,
): Promise<result.Result<string, string>> {
  // The TypeScript compiler, loaded when a patch asks for it, as a save loads
  // it: see `publishKit.ts`.
  const { tsOps, parseValFile } = await import("./patch/ts/publishKit");
  const applied = applyPatch(parseValFile(text), tsOps, patch);
  if (result.isErr(applied)) {
    const reason = messagesOf(applied.error).join(" ");
    return result.err(
      text.includes(".jsonValues(")
        ? `${reason} This module keeps entries in .val.json files of their own: change an entry by writing its file with write_files.`
        : reason,
    );
  }
  const sourceFile = applied.value;
  // As a save writes it: https://github.com/microsoft/TypeScript/issues/36174
  return result.ok(
    unescape(sourceFile.getText(sourceFile).replace(/\\u/g, "%u")),
  );
}

/**
 * A patch error, or a tree of syntax errors, as sentences. Walked here rather
 * than with `syntax.ts`'s `flattenErrors`, which would bring the compiler in
 * with this module.
 */
type ErrorTree = { message: string } | ErrorTree[];
function messagesOf(error: ErrorTree): string[] {
  return Array.isArray(error) ? error.flatMap(messagesOf) : [error.message];
}
