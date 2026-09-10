import {
  DEFAULT_VAL_REMOTE_HOST,
  Internal,
  type Json,
  type ModuleFilePath,
  type SourcePath,
  type ValidationError,
  type ValidationFix,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  createFixPatch,
  patchSourceFile,
  planJsonValuesEntryExtraction,
  type FixHandlerResult,
} from "@valbuild/server";
import {
  CodeAction,
  CodeActionKind,
  MarkupContent,
  type Diagnostic,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { GalleryCheckFinding, ValDiagnosticData } from "./diagnostics";
import {
  isRemoteFix,
  REMOTE_FIX_COMMANDS,
  REMOTE_FIX_TITLES,
  type RemoteFixCommandArgs,
} from "./commands";
import {
  findValModulesInsertion,
  valModuleSpecifier,
  valModulesEntryText,
} from "./valModulesRegistry";
import type { ValModuleContent } from "./ValProject";
import { jsonEntryEditFor, type JsonEntryEdit } from "./jsonEntryEdit";
import { supportsResourceOperation } from "./clientCapabilities";
import { minimalTextEdit } from "./textEdit";

// Re-exported: it lives in its own module so that `commands.ts` can use it
// without importing this one, which would close an import cycle.
export { minimalTextEdit };
import fs from "fs";
import path from "path";
import ts from "typescript";
import { pathToUri, uriToPath } from "./uri";

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

/**
 * Fixes that are local, but are NOT a patch against the document they are
 * reported on, so they never reach `computeFixEdit`.
 *
 * `jsonValues:extract-entry` creates a file and rewrites another — see
 * {@link createExtractEntryAction}. `createFixPatch` has no branch for it at all
 * (the fix lives in the server's own `extractJsonValuesEntry`), so routing it
 * through the patch pipeline would silently produce an empty patch and no
 * action, which is exactly what it did before this existed.
 */
const WORKSPACE_EDIT_FIXES: readonly ValidationFix[] = [
  "jsonValues:extract-entry",
];

/** Human-readable titles; falls back to the fix name for anything unknown. */
const FIX_TITLES: Partial<Record<ValidationFix, string>> = {
  "image:add-metadata": "Val: add image metadata",
  "image:check-metadata": "Val: update image metadata",
  "file:add-metadata": "Val: add file metadata",
  "file:check-metadata": "Val: update file metadata",
  "images:check-all-files": "Val: update gallery image metadata",
  "files:check-all-files": "Val: update gallery file metadata",
  "jsonValues:extract-entry": "Val: move entry into its own .val.json",
};

export function isLocalFix(fix: string): fix is ValidationFix {
  return (LOCAL_FIXES as readonly string[]).includes(fix);
}

export function isWorkspaceEditFix(fix: string): fix is ValidationFix {
  return (WORKSPACE_EDIT_FIXES as readonly string[]).includes(fix);
}

/** Whether the client will honour a file CREATE inside a `WorkspaceEdit`. */
export function canCreateFiles(capabilities: unknown): boolean {
  return supportsResourceOperation(capabilities, "create");
}

/**
 * Build quick fixes for the diagnostics the client sent back.
 *
 * The client returns our `Diagnostic.data` verbatim, which is where the source
 * path and available fixes come from — no re-deriving them from a code string.
 */
/**
 * LSP 10 widened `Diagnostic.message` to `string | MarkupContent`. Every
 * diagnostic this server produces carries a plain string (see `diagnostics.ts`),
 * but the type no longer says so, and both the remote-fix command arguments and
 * `ValidationError.message` are strings.
 */
function diagnosticMessage(message: Diagnostic["message"]): string {
  return MarkupContent.is(message) ? message.value : message;
}

export async function createValCodeActions({
  document,
  diagnostics,
  content,
  valRoot,
  moduleFilePath,
  read,
  remoteHost = process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
  allowCreateFiles = false,
}: {
  document: TextDocument;
  diagnostics: Diagnostic[];
  content: ValModuleContent;
  valRoot: string;
  /**
   * Needed to offer the remote fixes, which run as commands -- and to fix a
   * `.jsonValues()` entry, whose content is in a file this document only
   * references.
   */
  moduleFilePath?: ModuleFilePath;
  /**
   * Reads an open buffer for a path. A fix that edits another file must see that
   * file as the editor has it, or the edit's ranges are computed against text
   * the editor is not showing.
   */
  read?: (fsPath: string) => string | undefined;
  remoteHost?: string;
  /**
   * Whether the client honours a file CREATE in a `WorkspaceEdit`. Without it
   * the extract-entry fix is not offered at all — see {@link canCreateFiles}.
   */
  allowCreateFiles?: boolean;
}): Promise<CodeAction[]> {
  const actions: CodeAction[] = [];
  /**
   * Fixes already offered, as `<fix target>|<fix>`.
   *
   * One problem can be reported as several diagnostics that share a fix: a
   * stale image reports its width and its height separately, and a gallery
   * check reports one finding per entry. The fix is the same patch each time --
   * `createFixPatch` corrects every field, and the gallery branch walks every
   * entry -- so without this the editor offers the identical "Val: update image
   * metadata" twice, and recomputes it (re-reading the image) to do so.
   */
  const offered = new Set<string>();

  for (const diagnostic of diagnostics) {
    const data = diagnostic.data as ValDiagnosticData | undefined;
    if (!data?.fixes?.length) {
      continue;
    }
    for (const fix of data.fixes) {
      // Remote fixes upload or download bytes, so they are commands rather than
      // edits: a quick fix that silently needed credentials would just fail,
      // whereas a command can say "you are not logged in".
      if (isRemoteFix(fix)) {
        const command = REMOTE_FIX_COMMANDS[fix];
        if (!command || !moduleFilePath) {
          continue;
        }
        const args: RemoteFixCommandArgs = {
          uri: document.uri,
          moduleFilePath,
          sourcePath: data.sourcePath as SourcePath,
          fix,
          message: diagnosticMessage(diagnostic.message),
          ...(data.value !== undefined ? { value: data.value } : {}),
        };
        actions.push({
          title: REMOTE_FIX_TITLES[fix] ?? `Val: ${fix}`,
          kind: CodeActionKind.QuickFix,
          command: {
            title: REMOTE_FIX_TITLES[fix] ?? fix,
            command,
            arguments: [args],
          },
        });
        continue;
      }
      if (isWorkspaceEditFix(fix)) {
        if (offered.has(`${data.sourcePath}|${fix}`)) {
          continue;
        }
        const action = createExtractEntryAction({
          document,
          sourcePath: data.sourcePath as SourcePath,
          content,
          valRoot,
          moduleFilePath,
          read,
          allowCreateFiles,
        });
        if (!action) {
          continue;
        }
        offered.add(`${data.sourcePath}|${fix}`);
        actions.push(action);
        continue;
      }
      if (!isLocalFix(fix)) {
        continue;
      }
      const fixTarget = data.fixSourcePath ?? data.sourcePath;
      if (offered.has(`${fixTarget}|${fix}`)) {
        continue;
      }
      const fixEdit = await computeFixEdit({
        document,
        // A gallery check is reported on the entry but fixed against the record
        // that contains it; everything else fixes where it is reported.
        sourcePath: (data.fixSourcePath ?? data.sourcePath) as SourcePath,
        // createFixPatch works one fix at a time; give it exactly this one so a
        // failing sibling fix cannot suppress this action.
        validationError: {
          message: diagnosticMessage(diagnostic.message),
          value: data.value,
          fixes: [fix],
        },
        content,
        valRoot,
        moduleFilePath,
        read,
        remoteHost,
      });
      if (!fixEdit) {
        continue;
      }
      offered.add(`${fixTarget}|${fix}`);
      actions.push(
        CodeAction.create(
          FIX_TITLES[fix] ?? `Val: ${fix}`,
          // Not always `document.uri`: a fix inside a `.jsonValues()` entry
          // edits the entry's own `*.val.json`, which is a different file from
          // the one the diagnostic is reported on.
          { changes: { [fixEdit.uri]: [fixEdit.edit] } },
          CodeActionKind.QuickFix,
        ),
      );
    }
  }

  return actions;
}

/**
 * The quick fix for `jsonValues:extract-entry`: move an entry that was written
 * inline in the `.val.ts` into its own `*.val.json`.
 *
 * Not a patch, and so not `computeFixEdit`. Two files change at once — a
 * `*.val.json` is created with the entry's content, and the `.val.ts` has the
 * inline value replaced by `c.json(() => import("./..."))` — and a `Patch` can
 * only edit one `.val.ts` and cannot create anything. That is why the fix is
 * `extractJsonValuesEntry` in the server rather than a `createFixPatch` branch,
 * and why the editor had no fix to offer for it at all until now: the patch
 * pipeline produced nothing and the action was dropped.
 *
 * The plan comes from the same `planJsonValuesEntryExtraction` that
 * `val validate --fix` runs, so the two cannot write different files; only the
 * last step differs. Here it is a `WorkspaceEdit`, so the change goes through
 * the editor's undo stack, and — crucially — is computed against the buffer the
 * user is looking at rather than what is on disk.
 */
function createExtractEntryAction({
  document,
  sourcePath,
  content,
  valRoot,
  moduleFilePath,
  read,
  allowCreateFiles,
}: {
  document: TextDocument;
  sourcePath: SourcePath;
  content: ValModuleContent;
  valRoot: string;
  moduleFilePath?: ModuleFilePath;
  read?: (fsPath: string) => string | undefined;
  allowCreateFiles: boolean;
}): CodeAction | undefined {
  if (!moduleFilePath || !allowCreateFiles) {
    return undefined;
  }
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  const parts = Internal.splitModulePath(modulePath);
  // Root-only by contract, exactly as the server's fix handler asserts: the
  // entry is a direct child of the module's root record/router.
  if (parts.length !== 1) {
    return undefined;
  }
  const entryKey = parts[0];
  const entryContent = entryContentOf(content.source, entryKey);
  if (entryContent === undefined) {
    return undefined;
  }
  const planned = planJsonValuesEntryExtraction({
    moduleFilePath,
    entryKey,
    content: entryContent,
    valTsPath: uriToPath(document.uri),
    // The editor's text, not the file's: an edit computed against stale text
    // has ranges that land in the wrong place.
    valTsText: document.getText(),
  });
  if (result.isErr(planned)) {
    return undefined;
  }
  const absoluteJsonPath = path.join(valRoot, planned.value.jsonPath);
  // Same refusal as the CLI's, widened by one case: an unsaved buffer counts as
  // occupied too. Creating over either would destroy content that a `--fix` run
  // refuses to touch.
  if (
    read?.(absoluteJsonPath) !== undefined ||
    fs.existsSync(absoluteJsonPath)
  ) {
    return undefined;
  }
  const valTsEdit = minimalTextEdit(
    document.getText(),
    planned.value.valTsContent,
    document,
  );
  if (!valTsEdit) {
    return undefined;
  }
  const jsonUri = pathToUri(absoluteJsonPath);
  return {
    title:
      FIX_TITLES["jsonValues:extract-entry"] ??
      "Val: move entry into its own .val.json",
    kind: CodeActionKind.QuickFix,
    edit: {
      // `documentChanges`, not `changes`: a plain edit map cannot create a file,
      // and an edit addressed to a file that does not exist is an error rather
      // than a creation.
      documentChanges: [
        { kind: "create", uri: jsonUri },
        {
          textDocument: { uri: jsonUri, version: null },
          edits: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: planned.value.jsonContent,
            },
          ],
        },
        {
          textDocument: { uri: document.uri, version: null },
          edits: [valTsEdit],
        },
      ],
    },
  };
}

/**
 * One entry's value out of a module's source.
 *
 * `Object.entries` rather than an index: the source is a `Source`, which has no
 * index signature, and reading a dynamic key off it is the one thing this needs
 * to do. Mirrors what the server's fix handler reads, so the editor extracts the
 * same bytes `val validate --fix` would.
 */
function entryContentOf(source: unknown, entryKey: string): Json | undefined {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  for (const [key, value] of Object.entries(source)) {
    if (key === entryKey) {
      return value;
    }
  }
  return undefined;
}

async function computeFixEdit({
  document,
  sourcePath,
  validationError,
  content,
  valRoot,
  moduleFilePath,
  read,
  remoteHost,
}: {
  document: TextDocument;
  sourcePath: SourcePath;
  validationError: ValidationError;
  content: ValModuleContent;
  valRoot: string;
  moduleFilePath?: ModuleFilePath;
  read?: (fsPath: string) => string | undefined;
  remoteHost: string;
}): Promise<JsonEntryEdit | undefined> {
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
  // The value may not be in this file at all. A `.jsonValues()` entry's content
  // lives in its own `*.val.json`, and applying the patch to the `.val.ts` would
  // walk into the `c.json(...)` thunk and fail -- which is exactly why no quick
  // fix was offered inside an entry.
  if (moduleFilePath) {
    const entryEdit = jsonEntryEditFor({
      patch: fixed.patch,
      schema: content.schema,
      moduleFilePath,
      valTsText: before,
      valRoot,
      read,
    });
    if (entryEdit) {
      return entryEdit;
    }
  }
  const patched = patchSourceFile(before, fixed.patch);
  if (result.isErr(patched)) {
    return undefined;
  }
  const edit = minimalTextEdit(before, patched.value.text, document);
  return edit && { uri: document.uri, edit };
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
