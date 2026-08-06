import {
  DEFAULT_VAL_REMOTE_HOST,
  type SourcePath,
  type ValidationError,
  type ValidationFix,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { createFixPatch, patchSourceFile } from "@valbuild/server";
import {
  CodeAction,
  CodeActionKind,
  type Diagnostic,
  type Range,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ValDiagnosticData } from "./diagnostics";
import type { ValModuleContent } from "./ValProject";

/**
 * Quick fixes, built by running Val's own fix machinery.
 *
 * The pipeline is deliberately the same one `val validate --fix` uses:
 *
 *   ValidationError -> createFixPatch -> Patch -> patchSourceFile -> TextEdit
 *
 * so an editor fix and a CLI fix cannot diverge. The previous VS Code extension
 * hand-wrote AST edits per fix kind, which is how the two drifted apart.
 */

/**
 * Fixes that can be computed locally, without network access or credentials.
 *
 * Remote upload/download need a logged-in session and are handled by a separate
 * flow, so they are not offered as plain quick fixes: a code action that
 * silently required auth would just fail.
 */
const LOCAL_FIXES: readonly ValidationFix[] = [
  "image:add-metadata",
  "image:check-metadata",
  "file:add-metadata",
  "file:check-metadata",
];

/** Human-readable titles; falls back to the fix name for anything unknown. */
const FIX_TITLES: Partial<Record<ValidationFix, string>> = {
  "image:add-metadata": "Val: add image metadata",
  "image:check-metadata": "Val: update image metadata",
  "file:add-metadata": "Val: add file metadata",
  "file:check-metadata": "Val: update file metadata",
};

export function isLocalFix(fix: string): fix is ValidationFix {
  return (LOCAL_FIXES as readonly string[]).includes(fix);
}

/**
 * Build quick fixes for the diagnostics the client sent back.
 *
 * The client returns our `Diagnostic.data` verbatim, which is where the source
 * path and available fixes come from — no re-deriving them from a code string.
 */
export async function createValCodeActions({
  document,
  diagnostics,
  content,
  valRoot,
  remoteHost = process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
}: {
  document: TextDocument;
  diagnostics: Diagnostic[];
  content: ValModuleContent;
  valRoot: string;
  remoteHost?: string;
}): Promise<CodeAction[]> {
  const actions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    const data = diagnostic.data as ValDiagnosticData | undefined;
    if (!data?.fixes?.length) {
      continue;
    }
    for (const fix of data.fixes) {
      if (!isLocalFix(fix)) {
        continue;
      }
      const edit = await computeFixEdit({
        document,
        sourcePath: data.sourcePath as SourcePath,
        // createFixPatch works one fix at a time; give it exactly this one so a
        // failing sibling fix cannot suppress this action.
        validationError: {
          message: diagnostic.message,
          value: data.value,
          fixes: [fix],
        },
        content,
        valRoot,
        remoteHost,
      });
      if (!edit) {
        continue;
      }
      actions.push(
        CodeAction.create(
          FIX_TITLES[fix] ?? `Val: ${fix}`,
          { changes: { [document.uri]: [edit] } },
          CodeActionKind.QuickFix,
        ),
      );
    }
  }

  return actions;
}

async function computeFixEdit({
  document,
  sourcePath,
  validationError,
  content,
  valRoot,
  remoteHost,
}: {
  document: TextDocument;
  sourcePath: SourcePath;
  validationError: ValidationError;
  content: ValModuleContent;
  valRoot: string;
  remoteHost: string;
}): Promise<TextEdit | undefined> {
  let fixed;
  try {
    fixed = await createFixPatch(
      { projectRoot: valRoot, remoteHost },
      // `true` means "produce the patch"; nothing is written to disk here, the
      // patch is applied to the editor's text and returned as an edit.
      true,
      sourcePath,
      validationError,
      {},
      content.source,
      content.schema,
    );
  } catch {
    return undefined;
  }
  if (!fixed || fixed.patch.length === 0) {
    return undefined;
  }

  const before = document.getText();
  const patched = patchSourceFile(before, fixed.patch);
  if (result.isErr(patched)) {
    return undefined;
  }
  return minimalTextEdit(before, patched.value.text, document);
}

/**
 * Narrow an edit down to the region that actually changed.
 *
 * A whole-document replacement would work, but it moves the cursor and shows up
 * as a full-file change in review. Trimming the common prefix and suffix keeps
 * the edit tight without needing a real diff algorithm.
 */
export function minimalTextEdit(
  before: string,
  after: string,
  document: TextDocument,
): TextEdit | undefined {
  if (before === after) {
    return undefined;
  }

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const range: Range = {
    start: document.positionAt(prefix),
    end: document.positionAt(before.length - suffix),
  };
  return { range, newText: after.slice(prefix, after.length - suffix) };
}
