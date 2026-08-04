import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { PROTOCOL_VERSION, type ValServerCapabilities } from "./protocol";
import type { ValDiagnosticData } from "./diagnostics";

/**
 * End-to-end diagnostics: drives the real server as a child process over stdio,
 * opens a document, and waits for `textDocument/publishDiagnostics`.
 *
 * This exercises the whole chain — evaluate through QuickJS, map source paths to
 * ranges, publish over LSP — which unit tests of the pieces cannot.
 */

jest.setTimeout(90000);

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const EXAMPLE_APP = path.join(REPO_ROOT, "examples", "next");
const BIN = path.resolve(__dirname, "..", "bin.js");

type PublishedDiagnostics = {
  uri: string;
  diagnostics: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    message: string;
    severity?: number;
    source?: string;
    data?: ValDiagnosticData;
  }[];
};

type Session = {
  client: MessageConnection;
  capabilities: ValServerCapabilities | undefined;
  /** Resolves with the next publishDiagnostics for `uri`. */
  nextDiagnostics(uri: string): Promise<PublishedDiagnostics>;
  openDocument(uri: string, text: string): void;
  changeDocument(uri: string, version: number, text: string): void;
  dispose(): void;
};

async function startSession(): Promise<Session> {
  let child: ChildProcessWithoutNullStreams | undefined = spawn(
    process.execPath,
    [BIN, "--stdio"],
    { cwd: EXAMPLE_APP, stdio: ["pipe", "pipe", "pipe"] },
  );

  const client = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );

  const waiters = new Map<string, ((value: PublishedDiagnostics) => void)[]>();
  const received = new Map<string, PublishedDiagnostics[]>();

  client.onNotification(
    "textDocument/publishDiagnostics",
    (params: PublishedDiagnostics) => {
      const pending = waiters.get(params.uri);
      if (pending && pending.length > 0) {
        pending.shift()!(params);
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
    rootUri: `file://${EXAMPLE_APP}`,
    capabilities: {},
    initializationOptions: {
      client: { name: "diagnostics-test", version: "0.0.0" },
      supportedProtocolVersions: { min: 1, max: PROTOCOL_VERSION },
      valRoot: EXAMPLE_APP,
    },
  });
  client.sendNotification("initialized", {});

  return {
    client,
    capabilities: init.capabilities.experimental?.val,
    nextDiagnostics(uri) {
      const queued = received.get(uri);
      if (queued && queued.length > 0) {
        return Promise.resolve(queued.shift()!);
      }
      return new Promise((resolve) => {
        const pending = waiters.get(uri) ?? [];
        pending.push(resolve);
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
    dispose() {
      client.dispose();
      child?.kill();
      child = undefined;
    },
  };
}

describe("diagnostics over LSP", () => {
  let session: Session;

  beforeEach(async () => {
    session = await startSession();
  });

  afterEach(() => {
    session.dispose();
  });

  test("advertises the diagnostics feature", () => {
    expect(session.capabilities?.features).toContain("diagnostics");
  });

  test("publishes no diagnostics for a valid module", async () => {
    const file = path.join(EXAMPLE_APP, "content", "authors.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    expect(published.diagnostics).toEqual([]);
  });

  test("reports a validation error with structured fix data", async () => {
    // Known bad image metadata in the example app.
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    expect(published.diagnostics.length).toBeGreaterThan(0);

    const [first] = published.diagnostics;
    expect(first.source).toBe("val");
    expect(first.severity).toBe(1); // Error
    expect(first.data?.sourcePath).toContain("/content/media.val.ts");
    // Fixes travel in `data`, not smuggled through the `code` string.
    expect(first.data?.fixes?.length).toBeGreaterThan(0);
  });

  test("validates the editor's buffer, and recovers when it is fixed", async () => {
    const file = path.join(EXAMPLE_APP, "content", "authors.val.ts");
    const uri = `file://${file}`;
    const onDisk = fs.readFileSync(file, "utf8");

    session.openDocument(uri, onDisk);
    expect((await session.nextDiagnostics(uri)).diagnostics).toEqual([]);

    // Introduce a real validation error in the buffer only: authors' `name` is a
    // string, so a number must be rejected.
    session.changeDocument(
      uri,
      2,
      onDisk.replace('name: "', 'name: 123, _: "'),
    );
    const broken = await session.nextDiagnostics(uri);
    expect(broken.diagnostics.length).toBeGreaterThan(0);
    // Placed somewhere real in the file, not defaulted to the top.
    expect(broken.diagnostics[0].range.start.line).toBeGreaterThan(0);

    // Disk was never touched.
    expect(fs.readFileSync(file, "utf8")).toBe(onDisk);

    session.changeDocument(uri, 3, onDisk);
    expect((await session.nextDiagnostics(uri)).diagnostics).toEqual([]);
  });

  test("clears diagnostics when a document is closed", async () => {
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));
    expect(
      (await session.nextDiagnostics(uri)).diagnostics.length,
    ).toBeGreaterThan(0);

    session.client.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });
    expect((await session.nextDiagnostics(uri)).diagnostics).toEqual([]);
  });

  test("ignores non-Val TypeScript files", async () => {
    const uri = `file://${path.join(EXAMPLE_APP, "val.config.ts")}`;
    session.openDocument(uri, "export const x = 1;\n");

    // Nothing should be published; assert by racing a short timer.
    const published = await Promise.race([
      session.nextDiagnostics(uri).then(() => "published" as const),
      new Promise<"quiet">((r) => setTimeout(() => r("quiet"), 2000)),
    ]);
    expect(published).toBe("quiet");
  });
});
