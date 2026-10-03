import {
  VAL_SERVER_PATH,
  bakedGit,
  bakedJob,
  rebakeGit,
  wiredValServer,
} from "./wire";

/**
 * A rebuild has to move the commit, and may move nothing else.
 *
 * `BUILT_FROM` is the only place the commit appears in the generated server --
 * everything else in that file reads it -- so rewriting the line is the whole
 * job. What these are here to notice is the two ways that goes wrong: a
 * rewrite that misses (leaving a build compiled from new content and wired at
 * the commit before it, which reads back the wrong version of every file), and
 * a rewrite that hits more than it meant to.
 */

const wired = (git?: { commit: string; branch: string }) => ({
  [VAL_SERVER_PATH]: wiredValServer({
    project: "demo",
    loader: "https://loader.example",
    ...(git ? { git } : {}),
  }),
  "val.config.ts": "export const config = {};",
});

describe("rebaking the commit", () => {
  test("round-trips through the reader", () => {
    const next = { commit: "b".repeat(40), branch: "main" };
    expect(bakedGit(rebakeGit(wired(), next))).toEqual(next);
  });

  test("replaces a commit that was already there", () => {
    const before = { commit: "a".repeat(40), branch: "main" };
    const after = { commit: "c".repeat(40), branch: "main" };
    expect(bakedGit(rebakeGit(wired(before), after))).toEqual(after);
  });

  test("null puts it back to a build from no commit", () => {
    const files = wired({ commit: "a".repeat(40), branch: "main" });
    expect(bakedGit(rebakeGit(files, null))).toBeUndefined();
  });

  test("changes that one line and nothing else", () => {
    const before = wired({ commit: "a".repeat(40), branch: "main" });
    const after = rebakeGit(before, { commit: "d".repeat(40), branch: "main" });
    const differing = before[VAL_SERVER_PATH].split("\n")
      .map((line, at) => [line, after[VAL_SERVER_PATH].split("\n")[at]])
      .filter(([was, is]) => was !== is);
    expect(differing).toHaveLength(1);
    expect(differing[0][1]).toMatch(/^const BUILT_FROM = /);
  });

  test("leaves the caller's record alone", () => {
    const before = wired();
    const snapshot = { ...before };
    rebakeGit(before, { commit: "e".repeat(40), branch: "main" });
    expect(before).toEqual(snapshot);
  });

  test("a record with no wired server comes back unchanged", () => {
    // Not an error: a build of an unwired record is a real thing, and it fails
    // with its own message rather than with one about baking a commit.
    const files = { "val.config.ts": "export const config = {};" };
    expect(rebakeGit(files, { commit: "f".repeat(40), branch: "main" })).toBe(
      files,
    );
  });

  test("a val.server.ts this does not recognise comes back unchanged", () => {
    const files = {
      [VAL_SERVER_PATH]: "// hand-written, no BUILT_FROM here\n",
    };
    expect(rebakeGit(files, { commit: "0".repeat(40), branch: "main" })).toBe(
      files,
    );
  });
});

/**
 * A tab's build names the publish job it was made for, so the content service
 * can place it in the chain by that job rather than at whatever build is live.
 */
describe("rebaking the publish job", () => {
  const git = { commit: "a".repeat(40), branch: "main" };
  /** A file as generated before the job existed: no line, no option. */
  const wiredBeforeJobs = () => {
    const files = wired(git);
    const source = files[VAL_SERVER_PATH].replace(
      /\n\/\*\*\n \* The publish job this build[\s\S]*?\nconst BUILT_FOR_JOB = null;\n/,
      "\n",
    ).replace(
      "        ...(BUILT_FOR_JOB !== null ? { publishJob: BUILT_FOR_JOB } : {}),\n",
      "",
    );
    expect(source).not.toContain("BUILT_FOR_JOB");
    return { ...files, [VAL_SERVER_PATH]: source };
  };

  test("a freshly wired file names none", () => {
    expect(bakedJob(wired(git))).toBeUndefined();
  });

  test("round-trips through the reader, and null puts it back", () => {
    const withJob = rebakeGit(wired(git), git, "J-1");
    expect(bakedJob(withJob)).toBe("J-1");
    expect(bakedGit(withJob)).toEqual(git);
    expect(bakedJob(rebakeGit(withJob, git, null))).toBeUndefined();
  });

  test("a Studio that says nothing about jobs leaves the job as it was", () => {
    const withJob = rebakeGit(wired(git), git, "J-1");
    expect(bakedJob(rebakeGit(withJob, null))).toBe("J-1");
  });

  test("a file wired before jobs gets the line and the option, once", () => {
    const after = rebakeGit(wiredBeforeJobs(), git, "J-2")[VAL_SERVER_PATH];
    expect(bakedJob({ [VAL_SERVER_PATH]: after })).toBe("J-2");
    expect(after.split("publishJob: BUILT_FOR_JOB").length - 1).toBe(1);
    // In the same place a freshly wired file has them.
    const fresh = rebakeGit(wired(git), git, "J-2")[VAL_SERVER_PATH];
    const jobLines = (text: string) =>
      text.split("\n").filter((line) => line.includes("BUILT_FOR_JOB"));
    expect(jobLines(after)).toEqual(jobLines(fresh));
  });

  test("a file wired before jobs, rebaked with none, is not touched", () => {
    const before = wiredBeforeJobs();
    expect(rebakeGit(before, git, null)[VAL_SERVER_PATH]).toBe(
      before[VAL_SERVER_PATH],
    );
  });

  test("an edited file it cannot place the option in is left without a job", () => {
    const before = wiredBeforeJobs();
    const edited = {
      ...before,
      [VAL_SERVER_PATH]: before[VAL_SERVER_PATH].replace(
        "        projectSource: FILES,\n",
        "        projectSource: { ...FILES },\n",
      ),
    };
    expect(bakedJob(rebakeGit(edited, git, "J-3"))).toBeUndefined();
  });
});

describe("which build is running", () => {
  /*
   * A build's hash is taken of its output, so it cannot be baked in: the
   * platform hands it over at runtime (`VAL_BUILD`), the way it hands over
   * secrets, and the server sends it to the content service, which places the
   * build's overlay by it.
   */
  test("is read at runtime and handed to the server, and a rebake keeps it", () => {
    const source = wired()[VAL_SERVER_PATH];
    expect(source).toContain('const servedBuild = secret("VAL_BUILD");');
    expect(source).toContain(
      "...(servedBuild !== undefined ? { publishBuild: servedBuild } : {}),",
    );
    const rebaked = rebakeGit(
      wired(),
      { commit: "c".repeat(40), branch: "main" },
      "J-1",
    )[VAL_SERVER_PATH];
    expect(rebaked).toContain('const servedBuild = secret("VAL_BUILD");');
    expect(rebaked).toContain("{ publishBuild: servedBuild }");
  });
});
