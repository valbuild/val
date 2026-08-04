import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { PROTOCOL_VERSION, type ValServerCapabilities } from "../protocol";
import type { ValDiagnosticData } from "../diagnostics";

/**
 * A minimal LSP client that drives the real server as a child process.
 *
 * In-process is not an option: `vscode-languageserver/node` registers
 * `end`/`close` handlers on its input stream that call `process.exit()`, which
 * would kill the jest worker, and under `--stdio` it replaces the global
 * console. Spawning also means these tests exercise the same launch path an
 * editor uses.
 */

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
export const EXAMPLE_APP = path.join(REPO_ROOT, "examples", "next");
const BIN = path.resolve(__dirname, "..", "..", "bin.js");

export type PublishedDiagnostic = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  severity?: number;
  source?: string;
  code?: string;
  data?: ValDiagnosticData;
};

export type PublishedDiagnostics = {
  uri: string;
  diagnostics: PublishedDiagnostic[];
};

export type LspTextEdit = {
  range: PublishedDiagnostic["range"];
  newText: string;
};

export type LspCodeAction = {
  title: string;
  kind?: string;
  edit?: { changes?: Record<string, LspTextEdit[]> };
};

export type LspSession = {
  client: MessageConnection;
  capabilities: ValServerCapabilities | undefined;
  /**
   * Resolves with a publishDiagnostics for `uri`.
   *
   * Pass `match` to wait for a particular state rather than for whichever
   * notification happens to arrive next: validation is debounced, so an extra
   * publish can be emitted and positional waiting then desynchronises.
   */
  nextDiagnostics(
    uri: string,
    match?: (d: PublishedDiagnostics) => boolean,
  ): Promise<PublishedDiagnostics>;
  openDocument(uri: string, text: string): void;
  changeDocument(uri: string, version: number, text: string): void;
  closeDocument(uri: string): void;
  requestCodeActions(
    uri: string,
    diagnostics: PublishedDiagnostic[],
  ): Promise<LspCodeAction[]>;
  dispose(): void;
};

export async function startLspSession({
  valRoot = EXAMPLE_APP,
}: { valRoot?: string } = {}): Promise<LspSession> {
  let child: ChildProcessWithoutNullStreams | undefined = spawn(
    process.execPath,
    [BIN, "--stdio"],
    { cwd: valRoot, stdio: ["pipe", "pipe", "pipe"] },
  );

  const client = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );

  type Waiter = {
    match: (d: PublishedDiagnostics) => boolean;
    resolve: (value: PublishedDiagnostics) => void;
  };
  const waiters = new Map<string, Waiter[]>();
  const received = new Map<string, PublishedDiagnostics[]>();

  client.onNotification(
    "textDocument/publishDiagnostics",
    (params: PublishedDiagnostics) => {
      const pending = waiters.get(params.uri) ?? [];
      const index = pending.findIndex((w) => w.match(params));
      if (index !== -1) {
        const [waiter] = pending.splice(index, 1);
        waiter.resolve(params);
        return;
      }
      const queue = received.get(params.uri) ?? [];
      queue.push(params);
      received.set(params.uri, queue);
    },
  );
  client.onUnhandledNotification(() => {});
  client.listen();

  const init = await client.sendRequest<{
    capabilities: { experimental?: { val?: ValServerCapabilities } };
  }>("initialize", {
    processId: process.pid,
    rootUri: `file://${valRoot}`,
    capabilities: {},
    initializationOptions: {
      client: { name: "lsp-test-client", version: "0.0.0" },
      supportedProtocolVersions: { min: 1, max: PROTOCOL_VERSION },
      valRoot,
    },
  });
  client.sendNotification("initialized", {});

  return {
    client,
    capabilities: init.capabilities.experimental?.val,
    nextDiagnostics(uri, match = () => true) {
      const queued = received.get(uri) ?? [];
      const index = queued.findIndex(match);
      if (index !== -1) {
        const [hit] = queued.splice(index, 1);
        return Promise.resolve(hit);
      }
      return new Promise((resolve) => {
        const pending = waiters.get(uri) ?? [];
        pending.push({ match, resolve });
        waiters.set(uri, pending);
      });
    },
    openDocument(uri, text) {
      client.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: "typescript", version: 1, text },
      });
    },
    changeDocument(uri, version, text) {
      client.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    },
    closeDocument(uri) {
      client.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });
    },
    requestCodeActions(uri, diagnostics) {
      return client.sendRequest<LspCodeAction[]>("textDocument/codeAction", {
        textDocument: { uri },
        // Editors send the range of the current selection; the whole first
        // diagnostic's range is representative.
        range: diagnostics[0]?.range ?? {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        context: { diagnostics },
      });
    },
    dispose() {
      client.dispose();
      child?.kill();
      child = undefined;
    },
  };
}
