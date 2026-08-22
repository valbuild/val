import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { PROTOCOL_VERSION, type ValServerCapabilities } from "./protocol";

/**
 * Verifies the two supported ways to launch the server:
 *
 *  1. the `val-language-server` binary, which is what an editor resolves from
 *     the user's node_modules and spawns;
 *  2. `val lsp --stdio`, the discoverable CLI entry point.
 *
 * Both must complete a handshake, otherwise the launcher path an editor depends
 * on is broken regardless of how well the server itself works.
 */

jest.setTimeout(60000);

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const LANGUAGE_SERVER_BIN = path.resolve(__dirname, "..", "bin.js");
const CLI_BIN = path.resolve(REPO_ROOT, "packages", "cli", "bin.js");

async function handshakeAgainst(
  args: string[],
): Promise<{ val?: ValServerCapabilities; stderr: string }> {
  let child: ChildProcessWithoutNullStreams | undefined;
  let stderr = "";
  try {
    child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const client = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    client.onUnhandledNotification(() => {});
    client.listen();

    const result = await client.sendRequest<{
      capabilities: { experimental?: { val?: ValServerCapabilities } };
    }>("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      initializationOptions: {
        client: { name: "launch-test", version: "0.0.0" },
        supportedProtocolVersions: { min: 1, max: PROTOCOL_VERSION },
        valRoot: REPO_ROOT,
      },
    });
    client.dispose();
    return { val: result.capabilities.experimental?.val, stderr };
  } finally {
    child?.kill();
  }
}

test("the val-language-server binary completes a handshake over stdio", async () => {
  const { val, stderr } = await handshakeAgainst([
    LANGUAGE_SERVER_BIN,
    "--stdio",
  ]);
  expect(stderr).toBe("");
  expect(val?.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(val?.incompatible).toBeUndefined();
});

test("`val lsp --stdio` completes a handshake over stdio", async () => {
  const { val, stderr } = await handshakeAgainst([CLI_BIN, "lsp", "--stdio"]);
  // The CLI must not print anything to stderr on this path -- editors treat
  // stderr noise from a language server as a startup failure.
  expect(stderr).toBe("");
  expect(val?.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(val?.incompatible).toBeUndefined();
});
