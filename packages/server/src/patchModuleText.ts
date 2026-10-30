import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type Operation,
  type Patch,
} from "@valbuild/core/patch";
import {
  rebaseContentOp,
  resolveExistingJsonPath,
} from "./patch/jsonValuesPatch";

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
 * A patch written into a module's files: {@link patchModuleText}, and an op
 * that reaches INTO a `.jsonValues()` entry written into that entry's own
 * `*.val.json`, as a save routes it (`ValOps.prepare`).
 *
 * The design tab's `create_patch` used to refuse those, and the assistant
 * rewrote the whole entry file to change one field -- over whatever had been
 * saved into it since it read it.
 *
 * Only into an entry that is already there. Adding, replacing or removing a
 * whole entry is a key in the `.val.ts` and a file beside it, which a save
 * writes from the record's schema; here that is still `write_files`, and the
 * error says so.
 *
 * `readFile` answers a file by its path without a leading slash: the
 * proposal's copy, else the build's, `null` for one the proposal deleted.
 * `moduleText` is `null` when no op is the module file's own; `entries` is
 * each entry file written, by the same kind of path.
 */
export async function patchModuleFiles(
  moduleFilePath: string,
  text: string,
  readFile: (path: string) => string | null | undefined,
  patch: Patch,
): Promise<
  result.Result<
    { moduleText: string | null; entries: Record<string, JSONValue> },
    string
  >
> {
  const entryFiles = await jsonEntryFilesOf(moduleFilePath, text);
  const textOps: Operation[] = [];
  const entryOps = new Map<string, Operation[]>();
  for (const op of patch) {
    const key = op.path[0];
    // The record itself, or one of its entries as a whole -- a new one too,
    // which would otherwise be written into the record's text inline.
    if (entryFiles.size > 0 && op.path.length <= 1) {
      return result.err(
        `${key !== undefined ? `"${key}" is a whole entry` : "This is the whole record"} of a .jsonValues() record: add, replace or remove an entry by writing ${moduleFilePath} and the entry's .val.json with write_files.`,
      );
    }
    const entryFile = key !== undefined ? entryFiles.get(key) : undefined;
    if (key === undefined || entryFile === undefined) {
      textOps.push(op);
      continue;
    }
    if (op.op === "file") {
      return result.err(
        `A file in a .jsonValues() entry is uploaded by the Studio, not written here.`,
      );
    }
    if ((op.op === "move" || op.op === "copy") && op.from[0] !== key) {
      return result.err(
        `An op from one .jsonValues() entry into another is not written here: write the entries' .val.json files with write_files.`,
      );
    }
    const rebased = rebaseContentOp(op, 1);
    if (result.isErr(rebased)) return result.err(rebased.error.message);
    entryOps.set(entryFile, [
      ...(entryOps.get(entryFile) ?? []),
      rebased.value,
    ]);
  }

  let moduleText: string | null = null;
  if (textOps.length > 0) {
    const patched = await patchModuleText(text, textOps);
    if (result.isErr(patched)) return patched;
    moduleText = patched.value;
  }
  const entries: Record<string, JSONValue> = {};
  for (const [entryFile, ops] of entryOps) {
    const raw = readFile(entryFile);
    if (raw === null || raw === undefined) {
      return result.err(
        `${entryFile} is ${raw === null ? "deleted in this proposal" : "not in this proposal or on the site"}.`,
      );
    }
    let content: JSONValue;
    try {
      content = JSON.parse(raw);
    } catch {
      return result.err(`${entryFile} is not JSON.`);
    }
    const applied = applyPatch(deepClone(content), new JSONOps(), ops);
    if (result.isErr(applied)) {
      return result.err(`${entryFile}: ${messagesOf(applied.error).join(" ")}`);
    }
    entries[entryFile] = applied.value;
  }
  return result.ok({ moduleText, entries });
}

/**
 * Each `.jsonValues()` entry's file, by key, without a leading slash: from the
 * `c.json(() => import("..."))` thunks in the module's text. Empty for a
 * module that has none, or whose text cannot be read that way.
 */
async function jsonEntryFilesOf(
  moduleFilePath: string,
  text: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (!text.includes(".jsonValues(")) return files;
  const { parseValFile, analyzeValModule, analyzeJsonValuesEntries } =
    await import("./patch/ts/publishKit");
  try {
    const analysis = analyzeValModule(parseValFile(text));
    if (result.isErr(analysis)) return files;
    for (const [key, entry] of analyzeJsonValuesEntries(
      analysis.value.source,
    )) {
      files.set(
        key,
        resolveExistingJsonPath(moduleFilePath, entry.importPath).replace(
          /^\/+/,
          "",
        ),
      );
    }
  } catch {
    // No `c.define` (`analyzeValModule` throws): no entries.
  }
  return files;
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
