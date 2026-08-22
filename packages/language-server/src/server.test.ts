import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  PROTOCOL_VERSION,
  type ValInitializationOptions,
  type ValServerCapabilities,
} from "./protocol";

/**
 * These tests drive the server as a real child process over stdio -- exactly
 * how an editor client launches it.
 *
 * Running the server in-process is not an option: `vscode-languageserver/node`
 * registers `end`/`close` handlers on its input stream that call
 * `process.exit()` (lib/node/main.js), which would kill the jest worker, and
 * under `--stdio` it also replaces the global console. A child process sidesteps
 * both and tests the real launch path.
 */

const BIN = path.resolve(__dirname, "..", "bin.js");

// Spawning node and compiling TypeScript through preconstruct's require hook
// takes noticeably longer than an in-process test.
jest.setTimeout(30000);

type Server = {
  client: MessageConnection;
  child: ChildProcessWithoutNullStreams;
  stderr: () => string;
  dispose: () => void;
};

function startServer(): Server {
  const child = spawn(process.execPath, [BIN, "--stdio"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const client = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  // The server logs through `window/logMessage`; swallow it so an unhandled
  // notification does not surface as a test failure.
  client.onNotification("window/logMessage", () => {});
  client.onUnhandledNotification(() => {});
  client.listen();

  return {
    client,
    child,
    stderr: () => stderr,
    dispose: () => {
      client.dispose();
      child.kill();
    },
  };
}

function initializationOptions(
  overrides: Partial<ValInitializationOptions> = {},
): ValInitializationOptions {
  return {
    client: { name: "test-client", version: "1.2.3" },
    supportedProtocolVersions: { min: 1, max: PROTOCOL_VERSION },
    valRoot: "/tmp/some-val-project",
    ...overrides,
  };
}

type InitializeResponse = {
  capabilities: {
    experimental?: { val?: ValServerCapabilities };
    executeCommandProvider?: unknown;
  };
};

function initialize(
  server: Server,
  options: ValInitializationOptions | undefined,
  capabilities: Record<string, unknown> = {},
): Promise<InitializeResponse> {
  return server.client.sendRequest<InitializeResponse>("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities,
    ...(options ? { initializationOptions: options } : {}),
  });
}

describe("Val language server handshake", () => {
  let server: Server;

  beforeEach(() => {
    server = startServer();
  });

  afterEach(() => {
    server.dispose();
  });

  test("announces the negotiated protocol version and versions", async () => {
    const result = await initialize(server, initializationOptions());

    const val = result.capabilities.experimental?.val;
    expect(val).toBeDefined();
    expect(val?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(val?.incompatible).toBeUndefined();
    expect(val?.valRoot).toBe("/tmp/some-val-project");
    // Resolved from the @valbuild/core shipping alongside this server -- this is
    // what lets one client serve many Val versions.
    expect(typeof val?.versions.core).toBe("string");
    expect(typeof val?.versions.languageServer).toBe("string");
  });

  test("negotiates down to a client that only speaks v1", async () => {
    const result = await initialize(
      server,
      initializationOptions({ supportedProtocolVersions: { min: 1, max: 1 } }),
    );
    const val = result.capabilities.experimental?.val;
    expect(val?.protocolVersion).toBe(1);
    expect(val?.incompatible).toBeUndefined();
  });

  test("reports an actionable failure when the client is too old", async () => {
    const result = await initialize(
      server,
      // A client pinned below the range this server can speak.
      initializationOptions({ supportedProtocolVersions: { min: -1, max: 0 } }),
    );

    const val = result.capabilities.experimental?.val;
    // `incompatible` is the single flag a client checks to decide whether to
    // stop the server and which side to tell the user to update. Note that
    // vscode-languageserver injects `textDocumentSync` on its own, so absence
    // of capabilities is NOT a reliable signal.
    expect(val?.incompatible?.status).toBe("client-too-old");
    expect(val?.features).toEqual([]);
    expect(val?.commands).toEqual([]);
    expect(result.capabilities.executeCommandProvider).toBeUndefined();
  });

  test("still starts when a bare LSP client sends no initializationOptions", async () => {
    const result = await initialize(server, undefined);

    const val = result.capabilities.experimental?.val;
    expect(val?.incompatible).toBeUndefined();
    expect(val?.protocolVersion).toBe(1);
    expect(val?.valRoot).toBeTruthy();
  });

  test("accepts a client announcing the pick/input primitives", async () => {
    const result = await initialize(server, initializationOptions(), {
      experimental: { val: { pick: true, input: true } },
    });
    expect(result.capabilities.experimental?.val?.incompatible).toBeUndefined();
  });

  test("starts without writing anything to stderr", async () => {
    await initialize(server, initializationOptions());
    expect(server.stderr()).toBe("");
  });
});
