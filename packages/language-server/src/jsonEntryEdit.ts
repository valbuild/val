import fs from "fs";
import path from "path";
import ts from "typescript";
import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type Operation,
  type Patch,
} from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import {
  classifyJsonValuesOp,
  findJsonEntryFilePath,
  rebaseContentOp,
} from "@valbuild/server";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { TextEdit } from "vscode-languageserver";
import { minimalTextEdit } from "./textEdit";
import { pathToUri } from "./uri";

const jsonOps = new JSONOps();

/**
 * Turning a fix patch into an edit when the value it fixes is NOT in the
 * `.val.ts` the diagnostic was reported on.
 *
 * A `.jsonValues()` record keeps each entry's value in its own `*.val.json`; the
 * `.val.ts` holds `c.json(() => import("./x.val.json"))` and nothing below it.
 * So a fix for, say, an `s.image()` inside an entry produces a patch whose path
 * starts at the module root (`["/jobb/student", "pageImage", "width"]`) but
 * whose target lives in another file entirely.
 *
 * Applying such a patch to the `.val.ts` cannot work: the walk reaches the
 * `c.json(...)` call expression and `TSOps` refuses it ("Expression must be a
 * literal"). That refusal is why an editor silently offered no quick fix at all
 * for anything inside an entry — `computeFixEdit` saw an error result and
 * dropped the action.
 *
 * The routing here is the same one the Studio's publish and `val validate --fix`
 * use — {@link classifyJsonValuesOp} to find the entry, {@link rebaseContentOp}
 * to drop the entry-key prefix — so all three write the same file the same way.
 * What is specific to the editor is only the last step: the result comes back as
 * a `TextEdit` against the entry's document rather than as a write to disk, so
 * the edit goes through the editor's undo stack and respects an unsaved buffer.
 */
export type JsonEntryEdit = {
  /** The `*.val.json` the edit belongs to — NOT the document the fix was asked for. */
  uri: string;
  edit: TextEdit;
};

export function jsonEntryEditFor({
  patch,
  schema,
  moduleFilePath,
  valTsText,
  valRoot,
  read,
}: {
  patch: Patch;
  /** The module's root schema, which is what says whether it is `.jsonValues()`. */
  schema: SerializedSchema | undefined;
  moduleFilePath: ModuleFilePath;
  /** The `.val.ts` text, as the editor currently has it. */
  valTsText: string;
  valRoot: string;
  /** Reads an open buffer for a path, so an unsaved entry file is not clobbered. */
  read?: (fsPath: string) => string | undefined;
}): JsonEntryEdit | undefined {
  if (!schema) {
    return undefined;
  }
  const entry = entryOpsOf(patch, schema);
  if (!entry) {
    return undefined;
  }
  const jsonFilePath = findJsonEntryFilePath(
    moduleFilePath,
    ts.createSourceFile(moduleFilePath, valTsText, ts.ScriptTarget.ES2020),
    entry.entryKey,
  );
  if (!jsonFilePath) {
    return undefined;
  }
  const absolutePath = path.join(valRoot, jsonFilePath);
  const before = read?.(absolutePath) ?? readFile(absolutePath);
  if (before === undefined) {
    return undefined;
  }
  let content: JSONValue;
  try {
    content = JSON.parse(before);
  } catch {
    // A malformed entry file is already reported as a load error; offering an
    // edit computed from a guess at its contents would be worse than offering
    // nothing.
    return undefined;
  }
  for (const op of entry.ops) {
    // Root-only, like the rest of the `.jsonValues()` machinery, so the prefix
    // to drop is exactly the entry key.
    const rebased = rebaseContentOp(op, 1);
    if (result.isErr(rebased)) {
      return undefined;
    }
    const applied = applyPatch(deepClone(content), jsonOps, [rebased.value]);
    if (result.isErr(applied)) {
      return undefined;
    }
    content = applied.value;
  }
  // Re-serialising the whole value and diffing it is what keeps this honest:
  // the alternative is editing JSON text by hand, and the fix would then differ
  // from what the CLI writes. `minimalTextEdit` narrows the result to the region
  // that actually changed, so a two-space-indented file (what prettier and the
  // CLI both produce) yields an edit covering the changed properties and no
  // more. A file indented differently gets a correct but larger edit.
  const after =
    JSON.stringify(content, null, 2) + (before.endsWith("\n") ? "\n" : "");
  const uri = pathToUri(absolutePath);
  const edit = minimalTextEdit(
    before,
    after,
    TextDocument.create(uri, "json", 0, before),
  );
  return edit && { uri, edit };
}

/**
 * The ops of `patch`, if every one of them edits the content of ONE
 * `.jsonValues()` entry. `undefined` for anything else — an ordinary module, a
 * patch that also touches the `.val.ts`, or one that adds or removes a whole
 * entry — because those either belong on the `.val.ts` (the caller's existing
 * path) or need both files written at once, which a single `TextEdit` cannot do.
 */
function entryOpsOf(
  patch: Patch,
  schema: SerializedSchema,
): { entryKey: string; ops: Operation[] } | undefined {
  let entryKey: string | undefined;
  const ops: Operation[] = [];
  for (const op of patch) {
    const cls = classifyJsonValuesOp(schema, op.path);
    if (cls.kind !== "entry") {
      return undefined;
    }
    // Nested `.jsonValues()` is rejected as a module error long before a fix is
    // offered; treat it as out of scope rather than writing to a guessed file.
    if (cls.recordPath.length > 0 || cls.subPath.length === 0) {
      return undefined;
    }
    // `move` and `copy` carry a second path, and `rebaseContentOp` slices `from`
    // by the same prefix as `path` -- so an op reaching outside this entry would
    // have its source silently reinterpreted as a path inside this entry's file.
    if (op.op === "move" || op.op === "copy") {
      const fromCls = classifyJsonValuesOp(schema, op.from);
      if (fromCls.kind !== "entry" || fromCls.entryKey !== cls.entryKey) {
        return undefined;
      }
    }
    if (entryKey !== undefined && entryKey !== cls.entryKey) {
      return undefined;
    }
    entryKey = cls.entryKey;
    ops.push(op);
  }
  if (entryKey === undefined || ops.length === 0) {
    return undefined;
  }
  return { entryKey, ops };
}

function readFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}
