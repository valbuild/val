import { Internal } from "@valbuild/core";
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
 * Wire up a Val language server on an existing connection.
 *
 * Split out from {@link main} so it can be driven over a stream pair in tests
 * without spawning a process.
 */
export function createValLanguageServer(connection: Connection): {
  documents: TextDocuments<TextDocument>;
  /** Session state resolved during `initialize`; `undefined` until then. */
  getSession: () => ValSession | undefined;
} {
  const documents = new TextDocuments(TextDocument);
  let session: ValSession | undefined;

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

    // Phase 0: the handshake is in place but no language features are served
    // yet. Diagnostics, completions and commands are added in later phases and
    // announced here as they land.
    const features: ValFeature[] = [];
    const commands: string[] = [];

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
        executeCommandProvider: commands.length > 0 ? { commands } : undefined,
        experimental: { val },
      },
    };
  });

  connection.onShutdown(() => {
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
