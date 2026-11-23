import type { PickedElement } from "@valbuild/shared/internal";
import { readProjectContext } from "./projectContext";
import { createProjectSnapshot } from "./projectSnapshot";
import { pickedElementSources } from "./projectMap";
import { pickedElementPrompt } from "./proposalCode";

const SITE: Record<string, string> = {
  "AGENTS.md": "Use tabs.",
  "val.modules.ts": `export default modules(config, [{ def: () => import("./content/home.val") }]);`,
  "content/home.val.ts": "",
  "src/Home.tsx": `import homeVal from "../content/home.val";
export const Home = () => <h1 className="font-display text-5xl">x</h1>;`,
};

const NOTHING_STAGED = { files: [], inputs: null, buildRequired: false };

const picked: PickedElement = {
  tag: "h1",
  text: 'Say "hi"',
  classes: ["font-display", "text-5xl"],
  selector: "main > h1",
  valPath: '/content/home.val.ts?p="title"',
};

describe("what the assistant is told about the project in code mode", () => {
  test("one read gives the instructions and the map, of the proposal's files", async () => {
    let reads = 0;
    const context = await readProjectContext({
      proposal: { name: "p1" },
      siteSource: async () => {
        reads++;
        return SITE;
      },
      client: {
        files: async () => ({
          files: {
            "src/About.tsx": `import homeVal from "../content/home.val";`,
          },
          staged: NOTHING_STAGED,
        }),
      },
    });
    expect(reads).toBe(1);
    expect(context.instructions).toBe("### AGENTS.md\nUse tabs.");
    // The proposal's own file is in it: the map is of what read_file reads.
    expect(context.mapText).toContain(
      "content/home.val.ts <- src/About.tsx, src/Home.tsx",
    );
  });

  test("through the snapshot: asked once, and the map is made once, until the project moves", async () => {
    let fileReads = 0;
    let seq = 1;
    const client = {
      files: async () => {
        fileReads++;
        return {
          files: { "src/New.tsx": `// read ${fileReads}` },
          staged: NOTHING_STAGED,
        };
      },
    };
    const siteSource = async () => SITE;
    const snapshot = createProjectSnapshot({
      client,
      siteSource,
      seq: () => seq,
      stagedNow: async () => null,
    });
    const deps = { proposal: { name: "p1" }, client, siteSource, snapshot };
    const first = await readProjectContext(deps);
    const second = await readProjectContext(deps);
    expect(fileReads).toBe(1);
    expect(second).toBe(first);
    // The project moved: what is held is not current, and it is read again.
    seq = 2;
    snapshot.seqMoved();
    const third = await readProjectContext(deps);
    expect(fileReads).toBe(2);
    expect(third).not.toBe(first);
    expect(third.mapText).toContain("src/: Home.tsx, New.tsx");
  });

  test("a picked element names its module, who imports it, and its component", async () => {
    const context = await readProjectContext({
      proposal: null,
      siteSource: async () => SITE,
      client: { files: async () => ({ files: {}, staged: NOTHING_STAGED }) },
    });
    expect(
      pickedElementPrompt(
        picked,
        pickedElementSources(picked, context.project, context.map),
      ),
    ).toBe(
      '<picked tag="h1" classes="font-display text-5xl" selector="main &gt; h1" path="/content/home.val.ts?p=&quot;title&quot;" module="content/home.val.ts" imported-by="src/Home.tsx" classes-in="src/Home.tsx" text="Say &quot;hi&quot;"/>',
    );
  });

  test("outside code mode a picked element is told as it always was", () => {
    expect(pickedElementPrompt(picked)).toBe(
      '<picked tag="h1" classes="font-display text-5xl" selector="main &gt; h1" path="/content/home.val.ts?p=&quot;title&quot;" text="Say &quot;hi&quot;"/>',
    );
  });
});
