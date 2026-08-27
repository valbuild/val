import {
  DEFAULT_VAL_REMOTE_HOST,
  type ModuleFilePath,
  type SourcePath,
  type ValidationError,
  type ValidationFix,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  createFixPatch,
  patchSourceFile,
  type FixHandlerResult,
} from "@valbuild/server";
import {
  CodeAction,
  CodeActionKind,
  type Diagnostic,
  type Range,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  GalleryCheckFinding,
  ValDiagnosticData,
} from "./diagnostics";
import {
  findValModulesInsertion,
  valModuleSpecifier,
  valModulesEntryText,
} from "./valModulesRegistry";
import type { ValModuleContent } from "./ValProject";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { pathToUri } from "./uri";

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
  // Gallery metadata: createFixPatch reads each entry's file and corrects the
  // stored metadata, dropping entries whose file has gone. Filesystem only.
  "images:check-all-files",
  "files:check-all-files",
];

/** Human-readable titles; falls back to the fix name for anything unknown. */
const FIX_TITLES: Partial<Record<ValidationFix, string>> = {
  "image:add-metadata": "Val: add image metadata",
  "image:check-metadata": "Val: update image metadata",
  "file:add-metadata": "Val: add file metadata",
  "file:check-metadata": "Val: update file metadata",
  "images:check-all-files": "Val: update gallery image metadata",
  "files:check-all-files": "Val: update gallery file metadata",
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
        // A gallery check is reported on the entry but fixed against the record
        // that contains it; everything else fixes where it is reported.
        sourcePath: (data.fixSourcePath ?? data.sourcePath) as SourcePath,
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

/**
 * Quick fix for a module that is not registered in `val.modules`.
 *
 * Separate from {@link createValCodeActions} because it is not a
 * `ValidationError` at all — nothing is wrong with the module's content, it is
 * simply not listed, so there is no `createFixPatch` path to reuse. The edit
 * also lands in a *different* file than the diagnostic, which a `WorkspaceEdit`
 * handles natively and needs no extra client capability.
 *
 * Returns nothing when the `val.modules` file cannot be found or its `modules(
 * config, [ … ])` array cannot be located: an insertion at a guessed offset
 * produces a file that no longer compiles, which is worse than no fix.
 */
export function createMissingModuleCodeAction({
  valRoot,
  moduleFilePath,
  read,
}: {
  valRoot: string;
  moduleFilePath: string;
  /** The editor's view of a file, falling back to disk. */
  read: (fsPath: string) => string | undefined;
}): CodeAction | undefined {
  for (const candidate of ["val.modules.ts", "val.modules.js"]) {
    const file = path.join(valRoot, candidate);
    let text = read(file);
    if (text === undefined) {
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
    }
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ES2020,
      true,
    );
    const insertion = findValModulesInsertion(sourceFile);
    if (!insertion) {
      return undefined;
    }
    const specifier = valModuleSpecifier({
      // The val.modules file sits at the Val root, so its Val-style path is its
      // bare filename with a leading slash.
      valModulesFilePath: `/${candidate}`,
      moduleFilePath: moduleFilePath as never,
    });
    const position = sourceFile.getLineAndCharacterOfPosition(
      insertion.insertOffset,
    );
    const edit: TextEdit = {
      range: { start: position, end: position },
      newText: valModulesEntryText({
        specifier,
        indentation: insertion.indentation,
        hasElements: insertion.hasElements,
      }),
    };
    return CodeAction.create(
      `Val: register ${path.posix.basename(moduleFilePath)} in ${candidate}`,
      { changes: { [pathToUri(file)]: [edit] } },
      CodeActionKind.QuickFix,
    );
  }
  return undefined;
}

/**
 * Work out whether a gallery placeholder is hiding a real problem.
 *
 * Core attaches `images:check-unique-folder` and `images:check-all-files` to
 * every gallery module unconditionally — they are requests to go and look, not
 * findings. `val validate` looks by running the fix handler and then, when the
 * handler says the membership is fine, by running `createFixPatch` to compare
 * each entry's stored metadata against its file. Both steps matter:
 *
 *  - handler `success: false` — a membership problem, with its own message.
 *  - handler `shouldApplyPatch` — membership is fine; the metadata still has to
 *    be checked, and `createFixPatch` returns one `remainingError` per entry
 *    that disagrees with its file.
 *  - anything else — nothing to report, so the placeholder is dropped.
 *
 * Doing it exactly this way is the point: an editor that adjudicated these
 * itself would disagree with the CLI, and the first symptom would be a warning
 * that appears in one and not the other.
 */
export async function adjudicateGalleryCheck({
  sourcePath,
  validationError,
  moduleFilePath,
  valRoot,
  content,
  runFixHandler,
  remoteHost = process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
}: {
  sourcePath: SourcePath;
  validationError: ValidationError;
  moduleFilePath: ModuleFilePath;
  valRoot: string;
  content: ValModuleContent;
  runFixHandler: (args: {
    moduleFilePath: ModuleFilePath;
    sourcePath: SourcePath;
    validationError: ValidationError;
  }) => Promise<FixHandlerResult | undefined>;
  remoteHost?: string;
}): Promise<GalleryCheckFinding[]> {
  const outcome = await runFixHandler({
    moduleFilePath,
    sourcePath,
    validationError,
  });
  if (!outcome) {
    // No handler, or a project that would not evaluate. Keep the placeholder:
    // claiming the gallery is fine on no evidence is the worse error.
    return [
      {
        sourcePath,
        message: validationError.message,
        ...(validationError.fixes ? { fixes: validationError.fixes } : {}),
        ...(validationError.value !== undefined
          ? { value: validationError.value }
          : {}),
      },
    ];
  }
  if (!outcome.success) {
    return [
      {
        sourcePath,
        message: outcome.errorMessage ?? validationError.message,
        ...(validationError.fixes ? { fixes: validationError.fixes } : {}),
      },
    ];
  }
  if (outcome.fixableErrorMessage) {
    return [
      {
        sourcePath,
        message: outcome.fixableErrorMessage,
        ...(validationError.fixes ? { fixes: validationError.fixes } : {}),
      },
    ];
  }
  if (!outcome.shouldApplyPatch) {
    return [];
  }
  let fixed;
  try {
    fixed = await createFixPatch(
      { projectRoot: valRoot, remoteHost },
      // `false`: this is a question, not a fix. Asking for the patch would have
      // createFixPatch read and rewrite files behind the editor's back.
      false,
      sourcePath,
      validationError,
      {},
      content.source,
      content.schema,
    );
  } catch {
    return [];
  }
  return (fixed?.remainingErrors ?? []).map((error) => ({
    // A gallery check expands into per-entry errors carrying their own path;
    // fall back to the record's path when one does not.
    sourcePath: error.sourcePath ?? sourcePath,
    message: error.message,
    ...(error.fixes ? { fixes: error.fixes } : {}),
    // The fix runs against the record, not the entry: `createFixPatch`'s gallery
    // branch walks every entry itself and builds patch paths from the record's
    // path, so handing it the entry's path would write to the wrong place.
    fixSourcePath: sourcePath,
    ...(validationError.value !== undefined
      ? { value: validationError.value }
      : {}),
  }));
}
