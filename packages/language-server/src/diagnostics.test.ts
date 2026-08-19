import fs from "fs";
import path from "path";
import {
  startLspSession,
  EXAMPLE_APP,
  type LspSession,
} from "./__testHelpers__/lspClient";

/**
 * End-to-end diagnostics: drives the real server as a child process over stdio,
 * opens a document, and waits for `textDocument/publishDiagnostics`.
 *
 * This exercises the whole chain — evaluate the project, map source paths to
 * ranges, publish over LSP — which unit tests of the pieces cannot.
 */

jest.setTimeout(90000);

describe("diagnostics over LSP", () => {
  let session: LspSession;

  beforeEach(async () => {
    session = await startLspSession();
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

  test("reports a fixable validation error as a warning", async () => {
    // Known bad image metadata in the example app. Val's own CLI prints fixable
    // errors with a warning glyph, so an editor shows them as warnings.
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    const fixable = published.diagnostics.find(
      (d) => d.data?.code === "val/validation" && d.data?.fixes?.length,
    );
    expect(fixable).toBeDefined();
    expect(fixable!.source).toBe("val");
    expect(fixable!.severity).toBe(2); // Warning
    expect(fixable!.code).toBe("val/validation");
    expect(fixable!.data?.sourcePath).toContain("/content/media.val.ts");
    // Fixes travel in `data`, not smuggled through the `code` string.
    expect(fixable!.data?.fixes?.length).toBeGreaterThan(0);
  });

  test("reports a missing referenced file as val/file-not-found", async () => {
    // The example app references public/val/logo_7adc7.png, which is not there.
    const file = path.join(EXAMPLE_APP, "app", "page.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    const notFound = published.diagnostics.find(
      (d) => d.data?.code === "val/file-not-found",
    );
    expect(notFound).toBeDefined();
    // A missing file is not fixable, so it stays an error rather than becoming a
    // warning about metadata.
    expect(notFound!.severity).toBe(1);
    expect(notFound!.message).toMatch(/does not exist/);
    expect(notFound!.data?.filePath).toMatch(/logo_7adc7\.png$/);
    // Pointed at the reference argument, not the whole expression.
    expect(notFound!.range.start.line).toBeGreaterThan(0);
  });

  test("every diagnostic uses the val/ code convention", async () => {
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    expect(published.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of published.diagnostics) {
      expect(diagnostic.source).toBe("val");
      expect(diagnostic.code).toMatch(/^val\/[a-z-]+$/);
      // The code is always mirrored in data, so a client can rely on either.
      expect(diagnostic.data?.code).toBe(diagnostic.code);
    }
  });

  test("reports a module that val.modules does not register", async () => {
    // A file that is not listed in the example app's val.modules.
    const uri = `file://${path.join(EXAMPLE_APP, "content", "unregistered.val.ts")}`;
    session.openDocument(
      uri,
      `import { s, c } from "../val.config";
export default c.define("/content/unregistered.val.ts", s.object({ a: s.string() }), { a: "hi" });
`,
    );

    const published = await session.nextDiagnostics(uri);
    const missing = published.diagnostics.find(
      (d) => d.data?.code === "val/missing-module",
    );
    expect(missing).toBeDefined();
    expect(missing!.message).toMatch(/not registered in val\.modules/);
  });

  test("does not report missing-module for a registered module", async () => {
    const file = path.join(EXAMPLE_APP, "content", "authors.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    expect(
      published.diagnostics.filter(
        (d) => d.data?.code === "val/missing-module",
      ),
    ).toEqual([]);
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
    const broken = await session.nextDiagnostics(
      uri,
      (d) => d.diagnostics.length > 0,
    );
    expect(broken.diagnostics.length).toBeGreaterThan(0);
    // Placed somewhere real in the file, not defaulted to the top.
    expect(broken.diagnostics[0].range.start.line).toBeGreaterThan(0);

    // Disk was never touched.
    expect(fs.readFileSync(file, "utf8")).toBe(onDisk);

    session.changeDocument(uri, 3, onDisk);
    expect(
      (await session.nextDiagnostics(uri, (d) => d.diagnostics.length === 0))
        .diagnostics,
    ).toEqual([]);
  });

  test("clears diagnostics when a document is closed", async () => {
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));
    expect(
      (await session.nextDiagnostics(uri)).diagnostics.length,
    ).toBeGreaterThan(0);

    session.closeDocument(uri);
    expect(
      (await session.nextDiagnostics(uri, (d) => d.diagnostics.length === 0))
        .diagnostics,
    ).toEqual([]);
  });

  describe("keyOf and route resolution", () => {
    // Core cannot finish validating keyOf/route on its own -- it has to look at
    // other modules -- so it emits a placeholder with developer-facing text.
    // With a project-wide snapshot these are resolved properly: valid ones drop
    // out, invalid ones become actionable.
    const file = path.join(EXAMPLE_APP, "app", "page.val.ts");
    const uri = `file://${file}`;

    test("resolves valid keys and routes away entirely", async () => {
      session.openDocument(uri, fs.readFileSync(file, "utf8"));
      const published = await session.nextDiagnostics(uri);

      // No leaked placeholder text.
      for (const diagnostic of published.diagnostics) {
        expect(diagnostic.message).not.toMatch(/should typically be processed/);
        expect(diagnostic.message).not.toMatch(/^Did not validate/);
      }
      // And no lingering unresolved fixes of either kind.
      const deferred = published.diagnostics.filter((d) =>
        d.data?.fixes?.some(
          (f) => f === "keyof:check-keys" || f === "router:check-route",
        ),
      );
      expect(deferred).toEqual([]);
    });

    test("reports an invalid keyOf key with suggestions", async () => {
      const original = fs.readFileSync(file, "utf8");
      const broken = original.replace(
        /author:\s*"[^"]*"/,
        'author: "nope-not-a-key"',
      );
      // Guard against the fixture changing shape under us.
      expect(broken).not.toBe(original);

      session.openDocument(uri, original);
      await session.nextDiagnostics(uri);
      session.changeDocument(uri, 2, broken);

      const published = await session.nextDiagnostics(uri, (d) =>
        d.diagnostics.some((x) => x.message.includes("nope-not-a-key")),
      );
      const keyError = published.diagnostics.find((d) =>
        d.message.includes("nope-not-a-key"),
      )!;

      // Names the module the keys come from, and suggests near matches -- from
      // shared's findSimilar, not a vendored copy.
      expect(keyError.message).toContain("/content/authors.val.ts");
      expect(keyError.message).toMatch(/Closest match/);
      // Resolved into a real error, so no fix is offered for it any more.
      expect(keyError.data?.fixes).toBeUndefined();
    });
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
