import fs from "fs";
import path from "path";
import ts from "typescript";
import { Internal, type ModuleFilePath } from "@valbuild/core";
import {
  CodeActionKind,
  type CodeAction,
  type CompletionItem,
  type Diagnostic,
} from "vscode-languageserver";
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ValClientCapabilities,
  type ValFeature,
  type ValInitializationOptions,
  type ValServerCapabilities,
} from "./protocol";
import { getLanguageServerVersion } from "./version";
import { createValProject, type ValProject } from "./ValProject";
import {
  createValDiagnostics,
  createMissingModuleDiagnostic,
} from "./diagnostics";
import { createValCodeActions } from "./codeActions";
import { createValCompletions, resolveValCompletion } from "./completions";
import { createPublicValFiles, type PublicValFiles } from "./publicValFiles";
import { isModuleRegistered } from "./valModulesRegistry";
import { isValModuleUri, pathToUri, toModuleFilePath } from "./uri";

/**
 * How long to wait after an edit before re-evaluating.
 *
 * Evaluation is ~15ms per module (see scripts/evalLatency.bench.js), so this is
 * about avoiding pointless work mid-keystroke rather than about hiding latency.
 */
const VALIDATION_DEBOUNCE_MS = 200;

/**
 * Everything resolved during `initialize` that the rest of the server needs.
 * Held in one object so that later phases (diagnostics, completions, commands)
 * have a single place to read session state from.
 */
export type ValSession = {
  valRoot: string;
  clientCapabilities: ValClientCapabilities;
  protocolVersion: number;
  features: ValFeature[];
};

/**
 * Read and sanity-check the client's `initializationOptions`.
 *
 * A client that predates these options, or a bare LSP client such as a
 * hand-written Neovim config, may send nothing useful. Rather than failing, we
 * fall back to the workspace root and to the narrowest protocol range, so the
 * server still starts.
 */
export function parseInitializationOptions(
  params: InitializeParams,
): ValInitializationOptions {
  const raw = params.initializationOptions as
    | Partial<ValInitializationOptions>
    | null
    | undefined;

  const fallbackRoot =
    params.workspaceFolders?.[0]?.uri.replace(/^file:\/\//, "") ??
    params.rootPath ??
    process.cwd();

  return {
    client: {
      name: raw?.client?.name ?? params.clientInfo?.name ?? "unknown",
      version: raw?.client?.version ?? params.clientInfo?.version ?? null,
    },
    supportedProtocolVersions: raw?.supportedProtocolVersions ?? {
      min: 1,
      max: 1,
    },
    valRoot: raw?.valRoot ?? fallbackRoot,
    env: raw?.env,
  };
}

/**
 * Apply `VAL_*` overrides the client forwarded, so an editor session can be
 * pointed at a non-production Val backend without restarting the editor with a
 * modified environment.
 */
export function applyEnvOverrides(options: ValInitializationOptions): void {
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (typeof value === "string" && value) {
      process.env[key] = value;
    }
  }
}

/**
 * Report a Val module that `val.modules` does not register.
 *
 * Reads `val.modules.{ts,js}` from disk on demand. Returns `undefined` when no
 * such file exists — that is a project-level problem, not something to blame on
 * an individual module.
 */
function findMissingModuleDiagnostic(
  valRoot: string,
  moduleFilePath: ModuleFilePath,
): Diagnostic | undefined {
  for (const candidate of ["val.modules.ts", "val.modules.js"]) {
    const file = path.join(valRoot, candidate);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const registered = isModuleRegistered({
      sourceFile: ts.createSourceFile(file, text, ts.ScriptTarget.ES2020),
      valModulesDir: "",
      moduleFilePath,
    });
    return registered
      ? undefined
      : createMissingModuleDiagnostic({ moduleFilePath });
  }
  return undefined;
}

/**
 * Wire up a Val language server on an existing connection.
 *
 * Split out from {@link main} so `main` stays a thin transport choice.
 */
export function createValLanguageServer(connection: Connection): {
  documents: TextDocuments<TextDocument>;
  /** Session state resolved during `initialize`; `undefined` until then. */
  getSession: () => ValSession | undefined;
} {
  const documents = new TextDocuments(TextDocument);
  let session: ValSession | undefined;
  let project: ValProject | undefined;
  let publicFiles: PublicValFiles | undefined;
  const pending = new Map<string, NodeJS.Timeout>();

  /**
   * Re-evaluate a module and publish its diagnostics.
   *
   * Evaluation costs ~15ms, so this is debounced rather than run on every
   * keystroke, and a newer edit supersedes an in-flight timer for the same file.
   */
  function scheduleValidation(uri: string): void {
    const existing = pending.get(uri);
    if (existing) {
      clearTimeout(existing);
    }
    pending.set(
      uri,
      setTimeout(() => {
        pending.delete(uri);
        void validate(uri);
      }, VALIDATION_DEBOUNCE_MS),
    );
  }

  async function validate(uri: string): Promise<void> {
    const document = documents.get(uri);
    if (!project || !document || !isValModuleUri(uri)) {
      return;
    }
    const moduleFilePath = toModuleFilePath(project.valRoot, uri);
    if (!moduleFilePath) {
      return;
    }
    try {
      // The module's own content changed, so any cached result is stale.
      project.invalidate(moduleFilePath);
      const result = await project.getModule(moduleFilePath);
      if (result.status === "error") {
        // A project-level problem (no tsconfig, missing @valbuild/core) is not a
        // property of this file: report it once rather than on every module.
        connection.console.warn(
          `Val: ${result.error.code}: ${result.error.message}`,
        );
        connection.sendDiagnostics({ uri, diagnostics: [] });
        return;
      }
      // Needed to resolve keyOf/route validation, which has to look at other
      // modules. Built once and refreshed per changed module.
      const snapshotResult = await project.getSnapshot();
      const diagnostics = createValDiagnostics({
        moduleFilePath,
        content: result.content,
        text: document.getText(),
        valRoot: project.valRoot,
        ...(snapshotResult.status === "ok"
          ? { snapshot: snapshotResult.snapshot }
          : {}),
      });
      const unregistered = findMissingModuleDiagnostic(
        project.valRoot,
        moduleFilePath,
      );
      if (unregistered) {
        diagnostics.push(unregistered);
      }
      connection.sendDiagnostics({ uri, diagnostics });
    } catch (e) {
      // Never let a single bad module take the server down.
      connection.console.error(
        `Val: failed to validate ${uri}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  connection.onInitialize((params): InitializeResult => {
    const options = parseInitializationOptions(params);
    applyEnvOverrides(options);

    const negotiation = negotiateProtocolVersion(
      options.supportedProtocolVersions,
      SUPPORTED_PROTOCOL_VERSIONS,
    );

    const versions = {
      core: Internal.VERSION.core,
      languageServer: getLanguageServerVersion(),
    };

    if (negotiation.status !== "ok") {
      // Still return a valid InitializeResult: the client needs the payload
      // below to tell the user *which* side to update. It is the client's job
      // to stop the server after reading `incompatible`.
      const val: ValServerCapabilities = {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.max,
        incompatible: negotiation,
        versions,
        valRoot: options.valRoot,
        features: [],
        commands: [],
      };
      return { capabilities: { experimental: { val } } };
    }

    const clientCapabilities: ValClientCapabilities =
      (
        params.capabilities.experimental as
          | { val?: ValClientCapabilities }
          | undefined
      )?.val ?? {};

    // Announce only what this version actually serves: a client hides UI for
    // anything missing here, and ignores anything it does not recognise.
    // Completions and commands land in later phases.
    const features: ValFeature[] = [
      "diagnostics",
      "fix/metadata",
      "completions/mediaPath",
      "completions/keyOf",
      "completions/route",
      "fix/gallery",
      "completions/galleryKey",
    ];
    const commands: string[] = [];

    publicFiles = createPublicValFiles({ valRoot: options.valRoot });
    project = createValProject({
      valRoot: options.valRoot,
      open: {
        // Prefer the editor's buffer; fall back to disk for files the user has
        // not opened.
        read: (fsPath) => documents.get(pathToUri(fsPath))?.getText(),
      },
    });

    session = {
      valRoot: options.valRoot,
      clientCapabilities,
      protocolVersion: negotiation.protocolVersion,
      features,
    };

    connection.console.log(
      `Val language server ${versions.languageServer ?? "?"} ` +
        `(@valbuild/core ${versions.core ?? "?"}, protocol v${negotiation.protocolVersion}) ` +
        `serving ${options.valRoot} for ${options.client.name} ${options.client.version ?? "?"}`,
    );

    const val: ValServerCapabilities = {
      protocolVersion: negotiation.protocolVersion,
      versions,
      valRoot: options.valRoot,
      features,
      commands,
    };

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
        completionProvider: {
          resolveProvider: true,
          // Completing a path involves "/" and "." characters.
          triggerCharacters: ["/", "."],
        },
        executeCommandProvider: commands.length > 0 ? { commands } : undefined,
        experimental: { val },
      },
    };
  });

  connection.onCompletion(async (params): Promise<CompletionItem[]> => {
    const document = documents.get(params.textDocument.uri);
    if (
      !publicFiles ||
      !project ||
      !document ||
      !isValModuleUri(params.textDocument.uri)
    ) {
      return [];
    }
    try {
      const moduleFilePath = toModuleFilePath(
        project.valRoot,
        params.textDocument.uri,
      );
      // Only needed for schema-driven completions; file references do not use it.
      const snapshotResult = await project.getSnapshot();
      return createValCompletions({
        document,
        offset: document.offsetAt(params.position),
        files: publicFiles,
        ...(moduleFilePath ? { moduleFilePath } : {}),
        ...(snapshotResult.status === "ok"
          ? { snapshot: snapshotResult.snapshot }
          : {}),
      });
    } catch (e) {
      connection.console.error(
        `Val: failed to build completions: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  });

  connection.onCompletionResolve(async (item): Promise<CompletionItem> => {
    if (!project) {
      return item;
    }
    try {
      return await resolveValCompletion({ item, documents });
    } catch (e) {
      connection.console.error(
        `Val: failed to resolve completion: ${e instanceof Error ? e.message : String(e)}`,
      );
      return item;
    }
  });

  connection.onCodeAction(async (params): Promise<CodeAction[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!project || !document || !isValModuleUri(params.textDocument.uri)) {
      return [];
    }
    const moduleFilePath = toModuleFilePath(
      project.valRoot,
      params.textDocument.uri,
    );
    if (!moduleFilePath) {
      return [];
    }
    try {
      const result = await project.getModule(moduleFilePath);
      if (result.status === "error") {
        return [];
      }
      return await createValCodeActions({
        document,
        diagnostics: params.context.diagnostics,
        content: result.content,
        valRoot: project.valRoot,
      });
    } catch (e) {
      connection.console.error(
        `Val: failed to build code actions for ${params.textDocument.uri}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return [];
    }
  });

  // Validate when a module is opened and whenever it changes. `didChange` fires
  // per keystroke, which scheduleValidation debounces.
  documents.onDidOpen(({ document }) => scheduleValidation(document.uri));
  documents.onDidChangeContent(({ document }) =>
    scheduleValidation(document.uri),
  );

  documents.onDidClose(({ document }) => {
    const timer = pending.get(document.uri);
    if (timer) {
      clearTimeout(timer);
      pending.delete(document.uri);
    }
    // Clear our diagnostics so they do not linger for a file the user closed.
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  connection.onShutdown(() => {
    for (const timer of pending.values()) {
      clearTimeout(timer);
    }
    pending.clear();
    void project?.dispose();
    project = undefined;
    publicFiles = undefined;
    session = undefined;
  });

  documents.listen(connection);
  connection.listen();

  return { documents, getSession: () => session };
}

/**
 * Entry point used by `bin.js`.
 *
 * `createConnection` picks its transport from argv (`--stdio`, `--node-ipc`,
 * `--socket=`), so the same binary serves VS Code (IPC) and any other LSP
 * client (stdio).
 */
export function main(): void {
  createValLanguageServer(createConnection(ProposedFeatures.all));
}
