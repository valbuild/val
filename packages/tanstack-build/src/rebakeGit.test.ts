import { VAL_SERVER_PATH, bakedGit, rebakeGit, wiredValServer } from "./wire";

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
