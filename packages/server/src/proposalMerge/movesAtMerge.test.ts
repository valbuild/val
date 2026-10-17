import { initVal, type ModuleFilePath } from "@valbuild/core";
import { movesAtMerge, type MoveInputs } from "./movesAtMerge";

const { s } = initVal();

/*
 * Which of the site's pending changes a merge moves, from content's
 * `move-inputs` and the schemas: the rules are `changesToMove`'s (the
 * scenarios), this is what Val's server runs when Publish is pressed.
 */

const HOME = "/home.val.ts" as ModuleFilePath;
const schemas = {
  [HOME]: s.object({
    title: s.string(),
    subtitle: s.string(),
    tags: s.array(s.string()),
  }),
};
const SITE = { title: "Sale", subtitle: "Everything must go", tags: ["a"] };

const change = (
  patchId: string,
  authorName: string,
  path: string[],
  value: string,
): MoveInputs["pending"][number] => ({
  patchId,
  moduleFilePath: HOME,
  patch: [{ op: "replace", path, value }],
  author: `${authorName}-id`,
  authorName,
});

describe("movesAtMerge", () => {
  test("the change to a field the merge changes moves; the one to another field stays", () => {
    const moves = movesAtMerge(
      {
        siteHead: "site-2",
        pending: [
          change("k1", "Kari", ["title"], "Spring sale"),
          change("b1", "Bo", ["subtitle"], "Hot deals"),
        ],
        modules: {
          [HOME]: { site: SITE, merged: { ...SITE, title: "Summer sale" } },
        },
      },
      schemas,
    );
    expect(moves).toEqual({
      siteHead: "site-2",
      considered: ["k1", "b1"],
      groups: [["k1"]],
      authors: [["Kari"]],
    });
  });

  test("nothing the merge touches: nothing moves, and everything was looked at", () => {
    const moves = movesAtMerge(
      {
        siteHead: null,
        pending: [change("b1", "Bo", ["subtitle"], "Hot deals")],
        modules: { [HOME]: { site: SITE, merged: SITE } },
      },
      schemas,
    );
    expect(moves).toMatchObject({ considered: ["b1"], groups: [] });
  });

  test("a page this server has no schema for moves whole: what cannot be checked is not left to break", () => {
    const moves = movesAtMerge(
      {
        siteHead: null,
        pending: [change("b1", "Bo", ["subtitle"], "Hot deals")],
        modules: { [HOME]: { site: SITE, merged: SITE } },
      },
      {},
    );
    expect(moves.groups).toEqual([["b1"]]);
  });
});
