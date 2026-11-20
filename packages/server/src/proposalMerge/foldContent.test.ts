import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { foldContent } from "./foldContent";
import {
  jsonValuesPage,
  loadProject,
  scaffold,
  valFile,
  type Files,
} from "./project";

/*
 * Content written back into a project's files (valbuild/home,
 * docs/plans/connect-with-history.md, phase 6a): a project Val Build hosts
 * keeps its content as Source, and its `.val.ts` files still hold what it was
 * made with. Every case is checked the one way that matters: the files the
 * fold writes, loaded by Val's own loader, read back as exactly what was
 * recorded.
 */

const PAGE = "page.val.ts";
const PAGE_ID = `/${PAGE}` as ModuleFilePath;

const SCHEMA = `s.object({
    title: s.string(),
    body: s.richtext({ style: { bold: true } }),
    logo: s.image(),
    tags: s.array(s.string()),
    people: s.record(s.object({ name: s.string() })),
  })`;

const SEED: JSONValue = {
  title: "Welcome",
  body: [{ tag: "p", children: ["Hello"] }],
  logo: {
    path: "/public/val/logo.png",
    width: 10,
    height: 10,
    mimeType: "image/png",
  },
  tags: ["a", "b"],
  people: { ada: { name: "Ada" }, grace: { name: "Grace" } },
};

/** The seed's file, with a comment and code around the content a fold must keep. */
function seedFile(): string {
  return valFile(PAGE, SCHEMA, SEED).replace(
    `import { s, c } from "./val.config";`,
    `import { s, c } from "./val.config";\n\n// The front page. Keep this comment.`,
  );
}

const project = (files: Files): Files => ({
  ...scaffold(Object.keys(files).filter((f) => f.endsWith(".val.ts"))),
  ...files,
});

async function readBack(files: Files, id: ModuleFilePath) {
  return (await loadProject(files)).modules[id]?.source;
}

describe("foldContent", () => {
  test("text, rich text, an image, a list and a record, written so they read back exactly", async () => {
    const files = project({ [PAGE]: seedFile() });
    const recorded: JSONValue = {
      title: "Spring sale",
      body: [
        {
          tag: "p",
          children: [
            "Hello ",
            { tag: "span", styles: ["bold"], children: ["there"] },
          ],
        },
      ],
      logo: {
        path: "/public/val/spring_a1b2c.png",
        width: 20,
        height: 12,
        mimeType: "image/png",
        alt: "Spring",
      },
      tags: ["a", "b", "c"],
      people: { ada: { name: "Ada Lovelace" }, grace: { name: "Grace" } },
    };
    const folded = await foldContent({
      files,
      content: { [PAGE_ID]: recorded },
    });
    expect(folded.status).toBe("folded");
    if (folded.status !== "folded") return;
    expect(folded.changed).toEqual([PAGE]);
    expect(await readBack(folded.files, PAGE_ID)).toEqual(recorded);
    // What did not change is left as it was: the comment, the schema.
    expect(folded.files[PAGE]).toContain(
      "// The front page. Keep this comment.",
    );
    expect(folded.files[PAGE]).toContain(
      "s.richtext({ style: { bold: true } })",
    );
  });

  test("content that did not change leaves the file exactly as it was", async () => {
    const files = project({ [PAGE]: seedFile() });
    const folded = await foldContent({ files, content: { [PAGE_ID]: SEED } });
    expect(folded).toMatchObject({ status: "folded", changed: [] });
    if (folded.status !== "folded") return;
    expect(folded.files[PAGE]).toBe(files[PAGE]);
  });

  test("a record in another order is written in that order", async () => {
    const files = project({ [PAGE]: seedFile() });
    const recorded = {
      ...(SEED as Record<string, JSONValue>),
      people: { grace: { name: "Grace" }, ada: { name: "Ada" } },
    };
    const folded = await foldContent({
      files,
      content: { [PAGE_ID]: recorded },
    });
    expect(folded.status).toBe("folded");
    if (folded.status !== "folded") return;
    expect(JSON.stringify(await readBack(folded.files, PAGE_ID))).toBe(
      JSON.stringify(recorded),
    );
  });

  test("a .jsonValues() record: entries changed, added and removed, each its own file", async () => {
    const posts = jsonValuesPage(
      "posts.val.ts",
      "s.object({ title: s.string() })",
      {
        first: { title: "First" },
        second: { title: "Second" },
      },
    );
    const files = project({ [posts.file]: posts.text, ...posts.files });
    const recorded: JSONValue = {
      first: { title: "First, edited" },
      third: { title: "Third" },
    };
    const folded = await foldContent({
      files,
      content: { [posts.moduleFilePath]: recorded },
    });
    expect(folded.status).toBe("folded");
    if (folded.status !== "folded") return;
    expect(await readBack(folded.files, posts.moduleFilePath)).toEqual(
      recorded,
    );
    expect(folded.files["posts/second.val.json"]).toBeUndefined();
    expect(folded.changed).toEqual(
      expect.arrayContaining([
        "posts.val.ts",
        "posts/first.val.json",
        "posts/second.val.json",
        "posts/third.val.json",
      ]),
    );
  });

  test("a module left out of the content is not touched", async () => {
    const other = valFile("other.val.ts", "s.string()", "unchanged");
    const files = project({ [PAGE]: seedFile(), "other.val.ts": other });
    const folded = await foldContent({
      files,
      content: {
        [PAGE_ID]: { ...(SEED as Record<string, JSONValue>), title: "New" },
      },
    });
    expect(folded.status).toBe("folded");
    if (folded.status !== "folded") return;
    expect(folded.files["other.val.ts"]).toBe(other);
    expect(folded.changed).toEqual([PAGE]);
  });

  test("a computed value that changed is written as the value, as a save writes it", async () => {
    const computed = [
      `import { s, c } from "./val.config";`,
      ``,
      `const greeting = "Hello";`,
      ``,
      `export default c.define("/computed.val.ts", s.object({ title: s.string() }), {`,
      "  title: `${greeting} world`,",
      `});`,
      ``,
    ].join("\n");
    const files = project({ "computed.val.ts": computed });
    const id = "/computed.val.ts" as ModuleFilePath;
    const folded = await foldContent({
      files,
      content: { [id]: { title: "Goodbye" } },
    });
    expect(folded.status).toBe("folded");
    if (folded.status !== "folded") return;
    expect(await readBack(folded.files, id)).toEqual({ title: "Goodbye" });
  });

  test("a change inside content the code builds is refused by name, not guessed", async () => {
    const built = [
      `import { s, c } from "./val.config";`,
      ``,
      `function people() {`,
      `  return { ada: { name: "Ada" } };`,
      `}`,
      ``,
      `export default c.define(`,
      `  "/built.val.ts",`,
      `  s.object({ people: s.record(s.object({ name: s.string() })) }),`,
      `  { people: people() },`,
      `);`,
      ``,
    ].join("\n");
    const files = project({ "built.val.ts": built });
    const id = "/built.val.ts" as ModuleFilePath;
    const folded = await foldContent({
      files,
      content: { [id]: { people: { ada: { name: "Ada Lovelace" } } } },
    });
    expect(folded.status).toBe("refused");
    if (folded.status !== "refused") return;
    expect(folded.refusals).toEqual([
      {
        module: id,
        reason: expect.stringMatching(
          /^Its content could not be written into built\.val\.ts: /,
        ),
      },
    ]);
    expect(folded.refusals[0]!.reason).not.toContain("[object Object]");
  });

  test("content for a module the code does not have is refused by name", async () => {
    const files = project({ [PAGE]: seedFile() });
    const folded = await foldContent({
      files,
      content: { ["/gone.val.ts" as ModuleFilePath]: { title: "x" } },
    });
    expect(folded).toEqual({
      status: "refused",
      refusals: [
        {
          module: "/gone.val.ts",
          reason: expect.stringContaining("has no module /gone.val.ts"),
        },
      ],
    });
  });
});
