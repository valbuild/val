import { initVal, type ModuleFilePath } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import type { ValProposal } from "./proposal";

const { config, c, s } = initVal();

/*
 * The design tab's `create_patch` (valbuild/home `docs/design-tab.md`): a
 * patch written into a module's FILE in a proposal and staged there with its
 * code, at `POST /proposals-api/<name>/patch-file`.
 */

const NAME = "0123456789abcdef0123";
const OTHER = "fedcba9876543210fedc";
const PATH = "content/home.val.ts";
const SITE_TEXT = `import { s, c } from "../val.config";

export default c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "On the site" },
);
`;

let sent: Array<{ method: string; url: string; body: unknown }>;
let ownFiles: Record<string, string | null>;
beforeEach(() => {
  sent = [];
  ownFiles = {};
  jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    sent.push({ method, url: String(input), body });
    const answer =
      method === "GET"
        ? { files: ownFiles, staged: { files: [], inputs: null } }
        : { commit: "c-1", staged: { files: [PATH], buildRequired: true } };
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

const ops = (proposal?: ValProposal, withSource = true) =>
  new ValOpsHttp(
    "https://content.example",
    "org/project",
    null,
    { apiKey: "test" },
    { config, modules: [] },
    {
      config,
      ...(withSource ? { projectSource: { [PATH]: SITE_TEXT } } : {}),
      ...(proposal !== undefined ? { proposal } : {}),
    },
  );

const patchFile = (o: ValOpsHttp, name: string, value: string) =>
  o.proposalsApi(
    `/${name}/patch-file`,
    {
      method: "POST",
      body: JSON.stringify({
        moduleFilePath: `/${PATH}`,
        patch: [{ op: "replace", path: ["title"], value }],
        message: "A better title",
      }),
    },
    "profile-1",
  );

describe("a patch written into a module's file in a proposal", () => {
  test("the site's server writes it into the site's copy, and stages that in the proposal it names", async () => {
    const answer = await patchFile(ops(), NAME, "Worn for years");
    expect(answer.status).toBe(200);
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET https://content.example/v1/org/project/proposals/${NAME}/files`,
      `POST https://content.example/v1/org/project/proposals/${NAME}/files`,
    ]);
    const staged = sent[1]!.body as {
      files: Record<string, string>;
      message: string;
    };
    expect(staged.message).toBe("A better title");
    expect(staged.files[PATH]).toContain('{ title: "Worn for years" }');
    expect(staged.files[PATH]).toContain("s.object({ title: s.string() })");
  });

  test("the proposal's own copy is the one written into, when it has one", async () => {
    ownFiles = {
      [PATH]: SITE_TEXT.replace(
        "s.object({ title: s.string() })",
        "s.object({ title: s.string(), lede: s.string() })",
      ).replace(
        '{ title: "On the site" }',
        '{ title: "On the site", lede: "" }',
      ),
    };
    await patchFile(ops(), NAME, "Worn for years");
    const staged = sent[1]!.body as { files: Record<string, string> };
    expect(staged.files[PATH]).toContain("lede: s.string()");
    expect(staged.files[PATH]).toContain('title: "Worn for years"');
  });

  test("a patch that does not fit is refused, and nothing is staged", async () => {
    const answer = await ops().proposalsApi(
      `/${NAME}/patch-file`,
      {
        method: "POST",
        body: JSON.stringify({
          moduleFilePath: `/${PATH}`,
          patch: [{ op: "replace", path: ["nope", "deeper"], value: "x" }],
        }),
      },
      null,
    );
    expect(answer.status).toBe(422);
    expect(sent.map((r) => r.method)).toEqual(["GET"]);
  });

  test("a module deleted in the proposal is not written back", async () => {
    ownFiles = { [PATH]: null };
    const answer = await patchFile(ops(), NAME, "x");
    expect(answer.status).toBe(409);
    expect(sent.map((r) => r.method)).toEqual(["GET"]);
  });

  test("a build that carries no source says so, rather than that the module is not there", async () => {
    const answer = await patchFile(ops(undefined, false), NAME, "x");
    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body).message).toContain("write_files");
    expect(sent.map((r) => r.method)).toEqual(["GET"]);
  });

  test("a proposal's address writes only its own files", async () => {
    const own: ValProposal = {
      name: NAME,
      branch: `val/p/${NAME}`,
      commit: null,
      modules: {},
      files: {},
    };
    const answer = await patchFile(ops(own), OTHER, "x");
    expect(answer.status).toBe(403);
    expect(sent).toEqual([]);
  });
});

/*
 * A staging sends the Source its module files declare, so the proposal's
 * Source moves with its code (`stagedModuleSources`). Without it a field the
 * design tab added was in the module's text and its build, and not in the
 * Source the proposal's server served and saved: an edit into it showed on
 * the canvas and then reverted.
 */
describe("the Source a staged module file declares", () => {
  const withButtons = SITE_TEXT.replace(
    "s.object({ title: s.string() })",
    "s.object({ title: s.string(), buttons: s.array(s.object({ label: s.string() })) })",
  ).replace(
    '{ title: "On the site" }',
    '{ title: "On the site", buttons: [{ label: "New button" }] }',
  );

  test("goes with a patch written into a module's file", async () => {
    ownFiles = { [PATH]: withButtons };
    await patchFile(ops(), NAME, "Worn for years");
    const staged = sent[1]!.body as { modules?: Record<string, unknown> };
    expect(staged.modules).toEqual({
      [`/${PATH}`]: {
        title: "Worn for years",
        buttons: [{ label: "New button" }],
      },
    });
  });

  test("goes with module files a file tool stages, and only with those", async () => {
    const answer = await ops().proposalsApi(
      `/${NAME}/files`,
      {
        method: "POST",
        body: JSON.stringify({
          files: {
            [PATH]: withButtons,
            "src/Button.tsx": "export const Button = () => null;",
          },
          message: "Buttons",
        }),
      },
      "profile-1",
    );
    expect(answer.status).toBe(200);
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST https://content.example/v1/org/project/proposals/${NAME}/files`,
    ]);
    const staged = sent[0]!.body as {
      files: Record<string, string>;
      modules?: Record<string, unknown>;
      message: string;
    };
    expect(staged.message).toBe("Buttons");
    expect(Object.keys(staged.files).sort()).toEqual([PATH, "src/Button.tsx"]);
    expect(staged.modules).toEqual({
      [`/${PATH}`]: {
        title: "On the site",
        buttons: [{ label: "New button" }],
      },
    });
  });

  test("is left out where it cannot be read without running the module", async () => {
    const computed = SITE_TEXT.replace(
      '{ title: "On the site" }',
      "{ title: ['On', 'the', 'site'].join(' ') }",
    );
    await ops().proposalsApi(
      `/${NAME}/files`,
      {
        method: "POST",
        body: JSON.stringify({
          files: {
            [PATH]: computed,
            "content/shared.val.ts": "export const shared = 1;",
          },
        }),
      },
      "profile-1",
    );
    const staged = sent[0]!.body as { modules?: Record<string, unknown> };
    expect(staged.modules).toBeUndefined();
  });
});

/*
 * The same for a `.jsonValues()` record, whose Source holds a marker per
 * entry and whose entries' content is in their own `*.val.json` files. An
 * entry the design tab added -- a key in the `.val.ts` and its file -- was in
 * the proposal's code and not in its Source, which still named the entries
 * of the last save: the proposal's server did not have it, and an edit into
 * it was undone.
 */
describe("an entry staged into a .jsonValues() record", () => {
  const KB = "/app/kb.val.ts" as ModuleFilePath;
  const KB_PATH = "app/kb.val.ts";
  const kbText = (
    keys: string[],
    inline = "",
  ) => `import { c, s } from "../val.config";
export default c.define(
  "/app/kb.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
${keys.map((key) => `    ${key}: c.json(() => import("./kb/${key}.val.json")),`).join("\n")}${inline}
  },
);
`;
  // The proposal's build, made after the design tab added entry `c`.
  const kbModules = [
    {
      def: async () => ({
        default: c.define(
          KB,
          s.record(s.object({ title: s.string() })).jsonValues(),
          {
            a: c.json(() => Promise.resolve({ default: { title: "a" } })),
            b: c.json(() => Promise.resolve({ default: { title: "b" } })),
            c: c.json(() =>
              Promise.resolve({ default: { title: "c from the build" } }),
            ),
          },
        ),
      }),
    },
  ];
  /** What the proposal saved before the design tab added `c`. */
  const savedBefore = {
    [KB]: { a: { _type: "json" }, b: { _type: "json" } },
  };

  const stageFiles = async (files: Record<string, string>) => {
    const answer = await ops().proposalsApi(
      `/${NAME}/files`,
      { method: "POST", body: JSON.stringify({ files }) },
      "profile-1",
    );
    expect(answer.status).toBe(200);
    return sent[0]!.body as {
      files: Record<string, string>;
      modules?: Record<string, unknown>;
    };
  };

  test("is in the Source the proposal's server is handed, and its content is the staged file's", async () => {
    const staged = await stageFiles({
      [KB_PATH]: kbText(["a", "b", "c"]),
      "app/kb/c.val.json": JSON.stringify({ title: "c staged" }),
    });
    // What content then hands the proposal's address: the last save's
    // Source, with what the staging recorded over it.
    const proposal: ValProposal = {
      name: NAME,
      branch: `val/p/${NAME}`,
      commit: "staged-1",
      modules: { ...savedBefore, ...(staged.modules ?? {}) },
      files: staged.files,
    };
    const atProposal = new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      { config, modules: kbModules },
      { config, proposal },
    );
    const { sources } = await atProposal.getSources();
    expect(sources[KB]).toEqual({
      a: { _type: "json" },
      b: { _type: "json" },
      c: { _type: "json" },
    });
    expect(
      await atProposal.getJsonEntry(KB, "c", { applyPatches: false }),
    ).toEqual({ status: "success", content: { title: "c staged" } });
  });

  test("a value written inline beside the entries is sent as written", async () => {
    const staged = await stageFiles({
      [KB_PATH]: kbText(["a"], '\n    inline: { title: "Inline" },'),
    });
    expect(staged.modules).toEqual({
      [KB]: { a: { _type: "json" }, inline: { title: "Inline" } },
    });
  });

  test("an entry that is not a c.json(...) of an import leaves the module out", async () => {
    const staged = await stageFiles({
      [KB_PATH]: kbText(["a"], "\n    other: c.json(load),"),
    });
    expect(staged.modules).toBeUndefined();
  });

  const patchEntry = (patch: unknown[]) =>
    ops().proposalsApi(
      `/${NAME}/patch-file`,
      {
        method: "POST",
        body: JSON.stringify({ moduleFilePath: KB, patch }),
      },
      "profile-1",
    );

  test("a patch into an entry is written into the entry's own file, and nothing else", async () => {
    ownFiles = {
      [KB_PATH]: kbText(["a", "c"]),
      "app/kb/c.val.json": JSON.stringify({ title: "c staged" }),
    };
    const answer = await patchEntry([
      { op: "replace", path: ["c", "title"], value: "Edited" },
    ]);
    expect(answer.status).toBe(200);
    const staged = sent[1]!.body as {
      files: Record<string, string>;
      modules?: unknown;
    };
    expect(staged.files).toEqual({
      "app/kb/c.val.json": JSON.stringify({ title: "Edited" }, null, 2),
    });
    expect(staged.modules).toBeUndefined();
  });

  test("a patch of a whole entry is refused, and says to write the files", async () => {
    ownFiles = { [KB_PATH]: kbText(["a"]) };
    const answer = await patchEntry([
      { op: "add", path: ["d"], value: { title: "d" } },
    ]);
    // A new entry too: it would be written into the record inline.
    expect(answer.status).toBe(422);
    const replaced = await patchEntry([
      { op: "replace", path: ["a"], value: { title: "a" } },
    ]);
    expect(replaced.status).toBe(422);
    expect(JSON.parse(replaced.body).message).toContain("write_files");
    expect(sent.filter((r) => r.method === "POST")).toEqual([]);
  });
});
