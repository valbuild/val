import fs from "fs";
import path from "path";
import ts from "typescript";
import { Internal, type ModuleFilePath } from "@valbuild/core";
import { findAndEvalValConfigFile } from "@valbuild/server";
import {
  CodeActionKind,
  DidChangeWatchedFilesNotification,
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
  VAL_ENV_OVERRIDE_KEYS,
  type ProtocolVersionRange,
  type ValClientCapabilities,
  type ValEnvOverrides,
  type ValFeature,
  type ValInitializationOptions,
  type ValServerCapabilities,
} from "./protocol";
import { getLanguageServerVersion } from "./version";
import { createValProject, type ValProject } from "./ValProject";
import {
  createValDiagnostics,
  createMissingModuleDiagnostic,
  createProjectErrorDiagnostic,
  resolveGalleryChecks,
  type ValDiagnosticData,
} from "./diagnostics";
import {
  createValCodeActions,
  createMissingModuleCodeAction,
  adjudicateGalleryCheck,
} from "./codeActions";
import { createValCompletions, resolveValCompletion } from "./completions";
import { createValCommands, valCommandNames } from "./commands";
import {
  createPublicValFiles,
  DEFAULT_FILES_DIRECTORY,
  type PublicValFiles,
} from "./publicValFiles";
import { isModuleRegistered } from "./valModulesRegistry";
import { isValModuleUri, toModuleFilePath, uriToPath } from "./uri";

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

  const workspaceFolderUri = params.workspaceFolders?.[0]?.uri;
  const fallbackRoot =
    (workspaceFolderUri !== undefined ? uriToPath(workspaceFolderUri) : null) ??
    params.rootPath ??
    process.cwd();

  return {
    client: {
      name: raw?.client?.name ?? params.clientInfo?.name ?? "unknown",
      version: raw?.client?.version ?? params.clientInfo?.version ?? null,
    },
    supportedProtocolVersions: parseVersionRange(
      raw?.supportedProtocolVersions,
    ),
    valRoot: raw?.valRoot ?? fallbackRoot,
    env: pickEnvOverrides(raw?.env),
  };
}

/**
 * Read the protocol range a client claims to speak.
 *
 * Falls back to `{min: 1, max: 1}` for anything that is not a pair of finite
 * numbers. A half-filled object would otherwise produce `NaN` bounds, and every
 * comparison against `NaN` is false — which `negotiateProtocolVersion` reads as
 * "client too old" and refuses to serve, rather than as the graceful default a
 * bare LSP client is meant to get.
 */
function parseVersionRange(raw: unknown): ProtocolVersionRange {
  const fallback: ProtocolVersionRange = { min: 1, max: 1 };
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const { min, max } = raw as { min?: unknown; max?: unknown };
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max < min
  ) {
    return fallback;
  }
  return { min, max };
}

/**
 * Keep only the environment variables Val documents.
 *
 * `initializationOptions` is untyped JSON at runtime, so a client can send any
 * key at all. Dropping the rest here means neither this server nor anything
 * reading {@link ValInitializationOptions.env} downstream can be talked into
 * setting `PATH` or `NODE_OPTIONS`.
 *
 * Returns `undefined` when the client sent nothing usable, so that "no
 * overrides" stays distinguishable from "an empty set of overrides".
 */
function pickEnvOverrides(env: unknown): ValEnvOverrides | undefined {
  if (!env || typeof env !== "object") {
    return undefined;
  }
  const record: Record<string, unknown> = { ...env };
  const picked: ValEnvOverrides = {};
  let any = false;
  for (const key of VAL_ENV_OVERRIDE_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      picked[key] = value;
      any = true;
    }
  }
  return any ? picked : undefined;
}

/**
 * Apply `VAL_*` overrides the client forwarded, so an editor session can be
 * pointed at a non-production Val backend without restarting the editor with a
 * modified environment.
 */
export function applyEnvOverrides(options: ValInitializationOptions): void {
  const env = options.env;
  if (!env) {
    return;
  }
  // Iterate the allowlist rather than what was sent: `options` may have been
  // built by a caller that did not go through `parseInitializationOptions`.
  for (const key of VAL_ENV_OVERRIDE_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value) {
      process.env[key] = value;
    }
  }
}

/**
 * Files that every Val module is evaluated through, so an edit to one makes every
 * module's result stale rather than just its own.
 *
 * `val.modules` decides which modules Val serves at all; `val.config` is what the
 * modules import `c` and `s` from.
 */
const PROJECT_WIDE_FILE_RE = /[/\\]val\.(modules|config)\.(ts|js)$/;

/**
 * Report a Val module that `val.modules` does not register.
 *
 * Reads `val.modules.{ts,js}` on demand, through the editor's buffer when it is
 * open: adding a module to the registry must clear the diagnostic straight away,
 * not only once the user saves. Returns `undefined` when no such file exists —
 * that is a project-level problem, not something to blame on an individual
 * module.
 */
function findMissingModuleDiagnostic(
  valRoot: string,
  moduleFilePath: ModuleFilePath,
  read: (fsPath: string) => string | undefined,
): Diagnostic | undefined {
  for (const candidate of ["val.modules.ts", "val.modules.js"]) {
    const file = path.join(valRoot, candidate);
    let text: string | undefined = read(file);
    if (text === undefined) {
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
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
  let canRegisterWatchers = false;

  /**
   * The editor's view of a file, by absolute path, or `undefined` when the file
   * is not open.
   *
   * Found by comparing paths rather than by rebuilding the client's URI: URI
   * escaping is not something two serializers agree on byte for byte (`!`, `'`,
   * `(`, `)`, `*` and drive-letter colons all vary), and a near-miss would
   * silently fall back to disk — exactly the bug this server exists to avoid.
   * The number of open documents is small, so a scan is cheaper than keeping an
   * index in sync.
   */
  function readOpenDocument(fsPath: string): string | undefined {
    const wanted = path.normalize(fsPath);
    for (const document of documents.all()) {
      if (path.normalize(uriToPath(document.uri)) === wanted) {
        return document.getText();
      }
    }
    return undefined;
  }

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
        // A project-level problem (no tsconfig, missing @valbuild/core, a module
        // that throws while `val.modules` is evaluated) is not a property of this
        // file. It still has to be visible: publishing nothing would silently
        // drop every Val diagnostic and look like "all good".
        connection.console.warn(
          `Val: ${result.error.code}: ${result.error.message}`,
        );
        connection.sendDiagnostics({
          uri,
          diagnostics: [
            createProjectErrorDiagnostic({
              moduleFilePath,
              message: result.error.message,
            }),
          ],
        });
        return;
      }
      // Needed to resolve keyOf/route validation, which has to look at other
      // modules. Built once and refreshed per changed module.
      const snapshotResult = await project.getSnapshot();
      // Core attaches the gallery checks to every gallery module whether or not
      // anything is wrong, so they have to be adjudicated by the same fix
      // handlers `val validate` uses before any of them is shown.
      // Narrowed once: `project` is module-level and reassigned on shutdown, so
      // the closures below need a local binding.
      const activeProject = project;
      const galleryChecks =
        result.content.errors !== false && result.content.errors.validation
          ? await resolveGalleryChecks({
              validation: result.content.errors.validation,
              runHandler: (sourcePath, validationError) =>
                adjudicateGalleryCheck({
                  sourcePath,
                  validationError,
                  moduleFilePath,
                  valRoot: activeProject.valRoot,
                  content: result.content,
                  runFixHandler: (args) => activeProject.runFixHandler(args),
                }),
            })
          : undefined;
      const diagnostics = createValDiagnostics({
        moduleFilePath,
        content: result.content,
        text: document.getText(),
        valRoot: project.valRoot,
        ...(snapshotResult.status === "ok"
          ? { snapshot: snapshotResult.snapshot }
          : {}),
        ...(galleryChecks ? { galleryChecks } : {}),
      });
      const unregistered = findMissingModuleDiagnostic(
        project.valRoot,
        moduleFilePath,
        readOpenDocument,
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

    // Whether we may ask the client to watch files for us, rather than relying on
    // it having been configured to. A VS Code extension can set watchers up
    // itself; a hand-written Neovim config generally will not, and this is what
    // makes the server work the same in both.
    canRegisterWatchers =
      params.capabilities.workspace?.didChangeWatchedFiles
        ?.dynamicRegistration === true;

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
      "completions/richtextLink",
      "fix/missing-module",
      "fix/upload-remote",
      "fix/download-remote",
      "login",
    ];
    const commands: string[] = valCommandNames();

    publicFiles = createPublicValFiles({ valRoot: options.valRoot });
    // A project can point `files.directory` somewhere other than /public/val, and
    // media-path completions would list nothing if we assumed the default.
    // Reading val.config is async and `initialize` is not, so the default stands
    // until the real value arrives — completions cannot be requested before
    // `initialize` returns anyway.
    void findAndEvalValConfigFile(options.valRoot)
      .then((config) => {
        const directory = config?.files?.directory;
        if (directory && directory !== DEFAULT_FILES_DIRECTORY) {
          publicFiles = createPublicValFiles({
            valRoot: options.valRoot,
            directory,
          });
        }
      })
      .catch((e: unknown) => {
        // A broken or unreadable val.config is reported per module by the
        // service; here it only means "keep the default directory".
        connection.console.warn(
          `Val: could not read val.config: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    project = createValProject({
      valRoot: options.valRoot,
      open: {
        // Prefer the editor's buffer; fall back to disk for files the user has
        // not opened.
        read: readOpenDocument,
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

  const commandHandlers = createValCommands({
    connection,
    getProject: () => project,
    getDocument: (uri) => documents.get(uri),
  });

  connection.onExecuteCommand(async (params) => {
    try {
      await commandHandlers.execute(params.command, params.arguments ?? []);
    } catch (e) {
      // A command that throws must not take the server down with it.
      connection.console.error(
        `Val: ${params.command} failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  });

  connection.onInitialized(() => {
    if (!canRegisterWatchers) {
      return;
    }
    // Registered here rather than in `initialize`: dynamic registration is a
    // request to the client, and the client is not ready to answer one until it
    // has sent `initialized`.
    void connection.client
      .register(DidChangeWatchedFilesNotification.type, {
        watchers: [
          { globPattern: "**/*.val.{ts,js}" },
          { globPattern: "**/val.modules.{ts,js}" },
          { globPattern: "**/val.config.{ts,js}" },
          // Media completions and file-not-found diagnostics both read this
          // tree, and nothing else tells us a file arrived in it.
          { globPattern: "**/public/**" },
        ],
      })
      .catch((e: unknown) => {
        // A client that declined leaves us on document events alone, which is
        // what every client did before this existed.
        connection.console.warn(
          `Val: could not register file watchers: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
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
      const actions: CodeAction[] = [];

      // Registering a module in val.modules is not a content fix, so it is not
      // part of the createFixPatch pipeline: it is offered whenever the
      // diagnostic is present, even if the module could not be evaluated -- a
      // module Val does not serve is exactly the kind that fails to evaluate.
      const unregistered = params.context.diagnostics.some(
        (diagnostic) =>
          (diagnostic.data as ValDiagnosticData | undefined)?.code ===
          "val/missing-module",
      );
      if (unregistered) {
        const action = createMissingModuleCodeAction({
          valRoot: project.valRoot,
          moduleFilePath,
          read: readOpenDocument,
        });
        if (action) {
          actions.push(action);
        }
      }

      const result = await project.getModule(moduleFilePath);
      if (result.status === "error") {
        return actions;
      }
      actions.push(
        ...(await createValCodeActions({
          document,
          diagnostics: params.context.diagnostics,
          content: result.content,
          valRoot: project.valRoot,
          moduleFilePath,
        })),
      );
      return actions;
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
  documents.onDidChangeContent(({ document }) => {
    if (PROJECT_WIDE_FILE_RE.test(uriToPath(document.uri))) {
      // A project-wide fact changed, so every module's cached result is stale --
      // not just this file's. `invalidate()` with no argument clears the content
      // cache too, which the per-module fingerprint check would not.
      project?.invalidate();
      for (const open of documents.all()) {
        if (isValModuleUri(open.uri)) {
          scheduleValidation(open.uri);
        }
      }
      return;
    }
    scheduleValidation(document.uri);
  });

  /**
   * React to changes made outside the editor's buffers.
   *
   * `didChange` covers what the user types; it says nothing about a `git
   * checkout`, a `val validate --fix` run in a terminal, or an image dropped
   * into `/public/val`. Without this the server kept serving a stale evaluation
   * and stale completion candidates until something happened to be retyped —
   * and the watchers an editor had already been told to send were feeding a
   * handler that did not exist.
   */
  connection.onDidChangeWatchedFiles(({ changes }) => {
    if (!project) {
      return;
    }
    let projectWide = false;
    const changed: ModuleFilePath[] = [];
    for (const change of changes) {
      const fsPath = uriToPath(change.uri);
      if (fsPath === null) {
        continue;
      }
      if (PROJECT_WIDE_FILE_RE.test(fsPath)) {
        projectWide = true;
        continue;
      }
      // A file appearing or vanishing under the files directory changes what a
      // media path may complete to.
      publicFiles?.invalidate();
      if (!isValModuleUri(change.uri)) {
        continue;
      }
      const moduleFilePath = toModuleFilePath(project.valRoot, change.uri);
      if (moduleFilePath) {
        changed.push(moduleFilePath);
      }
    }

    if (projectWide) {
      project.invalidate();
      publicFiles?.invalidate();
      for (const open of documents.all()) {
        if (isValModuleUri(open.uri)) {
          scheduleValidation(open.uri);
        }
      }
      return;
    }

    for (const moduleFilePath of changed) {
      project.invalidate(moduleFilePath);
    }
    // A module the user is not looking at can still be the one that makes an
    // open module invalid -- a gallery it references, a record a keyOf points
    // at -- so revalidate every open module rather than only the changed ones.
    if (changed.length > 0) {
      for (const open of documents.all()) {
        if (isValModuleUri(open.uri)) {
          scheduleValidation(open.uri);
        }
      }
    }
  });

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
