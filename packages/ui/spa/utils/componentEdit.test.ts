import { initVal, type SourcePath } from "@valbuild/core";
import {
  componentChoicesOf,
  componentEditPatch,
  componentInsertPatch,
} from "./componentEdit";

const { s } = initVal();

const LIST = '/page.val.ts?p="/landing"."sections"' as SourcePath;

describe("an edit made on the page, as a patch", () => {
  test("a move is the list's own move op", () => {
    expect(
      componentEditPatch({ op: "move", list: LIST, from: 3, to: 0 }),
    ).toEqual({
      moduleFilePath: "/page.val.ts",
      patch: [
        {
          op: "move",
          from: ["/landing", "sections", "3"],
          path: ["/landing", "sections", "0"],
        },
      ],
    });
  });

  test("a removal names the item", () => {
    expect(componentEditPatch({ op: "remove", list: LIST, index: 2 })).toEqual({
      moduleFilePath: "/page.val.ts",
      patch: [{ op: "remove", path: ["/landing", "sections", "2"] }],
    });
  });

  test("an addition says where the new item is, to open it", () => {
    expect(componentInsertPatch(LIST, 1, { type: "quote" })).toEqual({
      moduleFilePath: "/page.val.ts",
      patch: [
        {
          op: "add",
          path: ["/landing", "sections", "1"],
          value: { type: "quote" },
        },
      ],
      itemPath: '/page.val.ts?p="/landing"."sections".1',
    });
  });

  test("a list at the root of a module", () => {
    const root = '/list.val.ts?p="items"' as SourcePath;
    expect(componentEditPatch({ op: "remove", list: root, index: 0 })).toEqual({
      moduleFilePath: "/list.val.ts",
      patch: [{ op: "remove", path: ["items", "0"] }],
    });
  });
});

describe("what a list can be added to with", () => {
  const hero = s
    .object({ type: s.literal("hero"), title: s.string() })
    .describe("A headline");
  const quote = s.object({ type: s.literal("quote"), quote: s.string() });

  test("a union offers its variants, named by their tag", () => {
    const choices = componentChoicesOf(
      s.array(s.discriminatedUnion("type", hero, quote))["executeSerialize"](),
    );
    expect(choices.status).toBe("kinds");
    if (choices.status !== "kinds") return;
    expect(choices.key).toBe("type");
    expect(choices.kinds.map((kind) => [kind.value, kind.description])).toEqual(
      [
        ["hero", "A headline"],
        ["quote", undefined],
      ],
    );
    expect(choices.kinds[0]?.schema.type).toBe("object");
  });

  test("a list of one schema has nothing to choose between", () => {
    const choices = componentChoicesOf(s.array(hero)["executeSerialize"]());
    expect(choices.status).toBe("one");
  });

  test("anything that is not a list cannot be added to", () => {
    expect(componentChoicesOf(hero["executeSerialize"]()).status).toBe(
      "not-a-list",
    );
  });
});
