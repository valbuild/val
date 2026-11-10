import { initVal, type ModuleFilePath } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import type { ValProposal } from "./proposal";

const { config, c, s } = initVal();

/*
 * Staging code in a proposal (`POST /proposals-api/<name>/files`), as its
 * own server does it: the Source the staged module files declare goes with
 * them (`stagedModuleSources`).
 */

const NAME = "0123456789abcdef0123";
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

/** The proposal, as its own server is handed it. */
const OWN: ValProposal = {
  name: NAME,
  branch: `val/p/${NAME}`,
  commit: null,
  modules: {},
  files: {},
};

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

/*
 * A staging sends the Source its module files declare, so the proposal's
 * Source moves with its code. Without it a field the assistant added was in
 * the module's text and its build, and not in the Source the proposal's
 * server served and saved: an edit into it showed on the canvas and then
 * reverted.
 */
describe("the Source a staged module file declares", () => {
  const withButtons = SITE_TEXT.replace(
    "s.object({ title: s.string() })",
    "s.object({ title: s.string(), buttons: s.array(s.object({ label: s.string() })) })",
  ).replace(
    '{ title: "On the site" }',
    '{ title: "On the site", buttons: [{ label: "New button" }] }',
  );

  test("goes with module files a file tool stages, and only with those", async () => {
    const answer = await ops(OWN).proposalsApi(
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
    await ops(OWN).proposalsApi(
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
 * entry the assistant added -- a key in the `.val.ts` and its file -- was in
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
  // The proposal's build, made after the assistant added entry `c`.
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
  /** What the proposal saved before the assistant added `c`. */
  const savedBefore = {
    [KB]: { a: { _type: "json" }, b: { _type: "json" } },
  };

  const stageFiles = async (files: Record<string, string>) => {
    const answer = await ops(OWN).proposalsApi(
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
});
