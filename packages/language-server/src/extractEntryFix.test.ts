import fs from "fs";
import path from "path";
import { canCreateFiles } from "./codeActions";
import {
  startLspSession,
  EXAMPLE_APP,
  type LspCodeAction,
  type LspDocumentChange,
  type LspSession,
  type LspTextEdit,
  type PublishedDiagnostic,
} from "./__testHelpers__/lspClient";

jest.setTimeout(90000);

/**
 * The quick fix for an entry written inline in a `.jsonValues()` module.
 *
 * The language server has always PUBLISHED this diagnostic correctly — the
 * `jsonValues:extract-entry` fix rode along in `data.fixes` — but offered no
 * action for it, so the editor showed a warning telling the reader to go and run
 * a CLI command. Two reasons, one behind the other: the fix was not in
 * `LOCAL_FIXES`, and `createFixPatch` has no branch for it either, so adding it
 * there would only have produced an empty patch and no action.
 *
 * What makes it different from every other quick fix is that it is not a patch
 * at all: it CREATES the `*.val.json` and rewrites the `.val.ts` to import it.
 */

const MODULE_FILE = path.join(EXAMPLE_APP, "content", "jsonEntryMedia.val.ts");
const MODULE_URI = `file://${MODULE_FILE}`;
const ON_DISK = fs.readFileSync(MODULE_FILE, "utf8");

/** The fixture, plus a second entry hand-authored inline. Buffer only, never written. */
const INLINE_ENTRY_TEXT = ON_DISK.replace(
  `    hero: c.json(() => import("./jsonEntryMedia/hero.val.json")),`,
  `    hero: c.json(() => import("./jsonEntryMedia/hero.val.json")),\n` +
    `    inlined: {\n` +
    `      image: {\n` +
    `        path: "/public/val/image.png",\n` +
    `        width: 944,\n` +
    `        height: 944,\n` +
    `        mimeType: "image/png",\n` +
    `      },\n` +
    `    },`,
);

/** What the fixed `.val.ts` should say, and where the content should land. */
const EXPECTED_IMPORT =
  'c.json(() => import("./jsonEntryMedia/inlined.val.json"))';
const EXPECTED_JSON_PATH = path.join(
  EXAMPLE_APP,
  "content",
  "jsonEntryMedia",
  "inlined.val.json",
);

/** A client that announces it will honour a file create inside a WorkspaceEdit. */
const CAN_CREATE = {
  workspace: { workspaceEdit: { resourceOperations: ["create", "rename"] } },
};

function isExtractAction(action: LspCodeAction): boolean {
  return action.title.includes("move entry into its own");
}

function applyEdit(text: string, edit: LspTextEdit): string {
  const lines = text.split("\n");
  const offsetOf = (position: { line: number; character: number }) => {
    let offset = 0;
    for (let i = 0; i < position.line; i++) {
      offset += lines[i].length + 1;
    }
    return offset + position.character;
  };
  return (
    text.slice(0, offsetOf(edit.range.start)) +
    edit.newText +
    text.slice(offsetOf(edit.range.end))
  );
}

function editsFor(
  changes: LspDocumentChange[] | undefined,
  uri: string,
): LspTextEdit[] {
  for (const change of changes ?? []) {
    if ("textDocument" in change && change.textDocument.uri === uri) {
      return change.edits;
    }
  }
  return [];
}

describe("canCreateFiles", () => {
  test("only true when the client announced the create operation", () => {
    expect(canCreateFiles(CAN_CREATE)).toBe(true);
    expect(
      canCreateFiles({
        workspace: { workspaceEdit: { resourceOperations: ["rename"] } },
      }),
    ).toBe(false);
    expect(canCreateFiles({ workspace: { workspaceEdit: {} } })).toBe(false);
    expect(canCreateFiles({})).toBe(false);
    expect(canCreateFiles(undefined)).toBe(false);
  });
});

describe("jsonValues:extract-entry quick fix", () => {
  test("the fixture really is a jsonValues module with an inline entry", () => {
    expect(INLINE_ENTRY_TEXT).not.toBe(ON_DISK);
    expect(ON_DISK).toContain("jsonValues()");
    // Nothing may exist at the target path, or the fix must refuse — the
    // "refuses to overwrite" test below depends on this being true first.
    expect(fs.existsSync(EXPECTED_JSON_PATH)).toBe(false);
  });

  describe("a client that can create files", () => {
    let session: LspSession;
    let diagnostics: PublishedDiagnostic[];
    let actions: LspCodeAction[];

    beforeAll(async () => {
      session = await startLspSession({ capabilities: CAN_CREATE });
      session.openDocument(MODULE_URI, INLINE_ENTRY_TEXT);
      const published = await session.nextDiagnostics(MODULE_URI, (d) =>
        d.diagnostics.some((x) =>
          x.data?.fixes?.some((f) => f === "jsonValues:extract-entry"),
        ),
      );
      diagnostics = published.diagnostics.filter((d) =>
        d.data?.fixes?.some((f) => f === "jsonValues:extract-entry"),
      );
      actions = await session.requestCodeActions(MODULE_URI, diagnostics);
    });

    afterAll(async () => {
      await session?.dispose();
    });

    test("the diagnostic carries the fix", () => {
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("written inline");
    });

    test("offers exactly one extract action", () => {
      expect(actions.filter(isExtractAction)).toHaveLength(1);
    });

    test("creates the *.val.json and fills it with the entry's content", () => {
      const changes = actions.find(isExtractAction)?.edit?.documentChanges;
      const jsonUri = `file://${EXPECTED_JSON_PATH}`;
      // The create must come FIRST: an edit addressed to a file that does not
      // exist yet is an error, not a creation.
      expect(changes?.[0]).toEqual({ kind: "create", uri: jsonUri });

      const [jsonEdit] = editsFor(changes, jsonUri);
      expect(jsonEdit).toBeDefined();
      expect(JSON.parse(jsonEdit.newText)).toEqual({
        image: {
          path: "/public/val/image.png",
          width: 944,
          height: 944,
          mimeType: "image/png",
        },
      });
    });

    test("rewrites the .val.ts to import it, and nothing is written to disk", () => {
      const changes = actions.find(isExtractAction)?.edit?.documentChanges;
      const [valTsEdit] = editsFor(changes, MODULE_URI);
      expect(valTsEdit).toBeDefined();

      const fixed = applyEdit(INLINE_ENTRY_TEXT, valTsEdit);
      expect(fixed).toContain(EXPECTED_IMPORT);
      // The inline value is gone, and the entry that was already extracted is
      // untouched.
      expect(fixed).not.toContain('path: "/public/val/image.png"');
      expect(fixed).toContain(
        'hero: c.json(() => import("./jsonEntryMedia/hero.val.json"))',
      );

      // A quick fix is an edit, not a write: the buffer is unsaved, so the file
      // on disk must still say what it said.
      expect(fs.readFileSync(MODULE_FILE, "utf8")).toBe(ON_DISK);
      expect(fs.existsSync(EXPECTED_JSON_PATH)).toBe(false);
    });

    test("refuses when something already lives at the target path", async () => {
      // Not a hypothetical: the CLI's fix throws in this case rather than
      // overwriting, and an editor that silently clobbered a file the CLI
      // refuses to touch would be the more dangerous of the two.
      fs.mkdirSync(path.dirname(EXPECTED_JSON_PATH), { recursive: true });
      fs.writeFileSync(EXPECTED_JSON_PATH, '{ "image": { "path": "x" } }\n');
      try {
        const again = await session.requestCodeActions(MODULE_URI, diagnostics);
        expect(again.filter(isExtractAction)).toHaveLength(0);
      } finally {
        fs.rmSync(EXPECTED_JSON_PATH);
      }
    });
  });

  describe("a client that cannot create files", () => {
    let session: LspSession;

    beforeAll(async () => {
      session = await startLspSession();
    });

    afterAll(async () => {
      await session?.dispose();
    });

    test("is offered nothing, rather than an edit that half-applies", async () => {
      // A create the client drops leaves the `.val.ts` importing a file that
      // does not exist — a module that no longer loads. Worse than the warning.
      session.openDocument(MODULE_URI, INLINE_ENTRY_TEXT);
      const published = await session.nextDiagnostics(MODULE_URI, (d) =>
        d.diagnostics.some((x) =>
          x.data?.fixes?.some((f) => f === "jsonValues:extract-entry"),
        ),
      );
      const actions = await session.requestCodeActions(
        MODULE_URI,
        published.diagnostics,
      );
      expect(actions.filter(isExtractAction)).toHaveLength(0);
    });
  });
});
