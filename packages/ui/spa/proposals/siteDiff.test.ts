import { initVal, Internal, type ModuleFilePath } from "@valbuild/core";
import { siteChangeTrees, sameJson } from "./siteDiff";
import type { ChangeTreeNode } from "../utils/computeChangedSourcePaths";

const { s, c } = initVal();

const PAGE = "/content/page.val.ts" as ModuleFilePath;
const site = {
  title: "Spring",
  body: [{ tag: "p" as const, children: ["Hello"] }],
  tags: ["a", "b"],
  people: { ada: { name: "Ada" }, kari: { name: "Kari" } },
};
const pageVal = c.define(
  PAGE,
  s.object({
    title: s.string(),
    body: s.richtext({}),
    tags: s.array(s.string()),
    people: s.record(s.object({ name: s.string() })),
  }),
  site,
);
const schema = Internal.getSchema(pageVal)?.["executeSerialize"]();

/** Every changed path in a tree, with its change, leaves only. */
function changes(tree: ChangeTreeNode | undefined): string[] {
  if (!tree) return [];
  const own = tree.change
    ? [`${tree.sourcePath} ${tree.change.changeType}`]
    : [];
  return [...own, ...tree.children.flatMap(changes)];
}

const diff = (now: unknown) =>
  changes(siteChangeTrees([{ moduleFilePath: PAGE, site, now, schema }])[0]);

test("nothing changed is no tree at all", () => {
  expect(
    siteChangeTrees([{ moduleFilePath: PAGE, site, now: site, schema }]),
  ).toEqual([]);
});

test("a changed field is that field, by its path", () => {
  expect(diff({ ...site, title: "Summer" })).toEqual([
    `${PAGE}?p="title" field-change`,
  ]);
});

test("rich text is one field, never a node inside it", () => {
  expect(diff({ ...site, body: [{ tag: "p", children: ["Bye"] }] })).toEqual([
    `${PAGE}?p="body" field-change`,
  ]);
});

test("record entries are added, removed and changed by key", () => {
  expect(
    diff({
      ...site,
      people: { ada: { name: "Ada L" }, ola: { name: "Ola" } },
    }).sort(),
  ).toEqual(
    [
      `${PAGE}?p="people"."ada"."name" field-change`,
      `${PAGE}?p="people"."kari" removed`,
      `${PAGE}?p="people"."ola" added`,
    ].sort(),
  );
});

test("an array that grew at its end lists what was added; one reshuffled is one change", () => {
  expect(diff({ ...site, tags: ["a", "b", "c"] })).toEqual([
    `${PAGE}?p="tags".2 added`,
  ]);
  expect(diff({ ...site, tags: ["c", "a", "b"] })).toEqual([
    `${PAGE}?p="tags" field-change`,
  ]);
});

test("JSON equality ignores key order and nothing else", () => {
  expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(
    true,
  );
  expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(sameJson([1, 2], [2, 1])).toBe(false);
  expect(sameJson(null, {})).toBe(false);
});
