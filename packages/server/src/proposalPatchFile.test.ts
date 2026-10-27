import { initVal } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import type { ValProposal } from "./proposal";

const { config } = initVal();

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

describe("the proposal's files formatted the way the project formats them", () => {
  // Stands in for prettier: collapses runs of spaces.
  const formatter = (code: string) => code.replace(/ {2,}/g, " ");
  const withFormatter = () =>
    new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      { config, modules: [] },
      {
        config,
        projectSource: { [PATH]: SITE_TEXT, "src/tidy.ts": "const a = 1;\n" },
        formatter,
      },
    );
  const format = (o: ValOpsHttp, body: unknown) =>
    o.proposalsApi(
      `/${NAME}/format`,
      { method: "POST", body: JSON.stringify(body) },
      "profile-1",
    );

  test("says which changed, and stages them when asked to write", async () => {
    ownFiles = { "src/messy.ts": "const  b =   2;\n" };
    const answer = await format(withFormatter(), {
      paths: ["src/messy.ts", "src/tidy.ts", "src/none.ts"],
      write: true,
    });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body).files).toEqual([
      { path: "src/messy.ts", status: "changed" },
      { path: "src/tidy.ts", status: "unchanged" },
      { path: "src/none.ts", status: "missing" },
    ]);
    expect(sent.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(sent[1]!.body).toEqual({
      files: { "src/messy.ts": "const b = 2;\n" },
      message: "Format",
    });
  });

  test("only reports, without write", async () => {
    ownFiles = { "src/messy.ts": "const  b = 2;\n" };
    const answer = await format(withFormatter(), { paths: ["src/messy.ts"] });
    expect(JSON.parse(answer.body).files).toEqual([
      { path: "src/messy.ts", status: "changed" },
    ]);
    expect(sent.map((r) => r.method)).toEqual(["GET"]);
  });

  test("with no paths, the files the proposal stages", async () => {
    ownFiles = { "src/messy.ts": "const  c = 3;\n" };
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const method = init?.method ?? "GET";
      sent.push({ method, url: String(input), body: null });
      return new Response(
        JSON.stringify({
          files: ownFiles,
          staged: { files: ["src/messy.ts"], inputs: "i" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const answer = await format(withFormatter(), {});
    expect(JSON.parse(answer.body).files).toEqual([
      { path: "src/messy.ts", status: "changed" },
    ]);
  });

  test("a site that gives Val no formatter says so, and reads nothing", async () => {
    const answer = await format(ops(), { paths: ["src/messy.ts"] });
    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body).message).toContain("formatter");
    expect(sent).toEqual([]);
  });
});
