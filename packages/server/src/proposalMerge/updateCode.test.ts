import { createHash } from "crypto";
import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { FOOTER, footer, HERO, hero, homePage } from "./fixtures";
import type { Resolution } from "./merge";
import { loadProject, projectOf, scaffold, type Files } from "./project";
import {
  sideFiles,
  sideSource,
  updateWithCode,
  type Evaluated,
  type MergeTrees,
  type Side,
} from "./updateCode";

/*
 * Update from the site with code, as Val's server runs it between content and
 * the builder tab (slice 1b). Content's half is `merge-trees` and the commit;
 * the tab's is evaluating each tree. Here content's answer is written out, and
 * the tab is Val's own loader -- the same evaluation, on Node.
 */

const HOME = "/home.val.ts" as ModuleFilePath;
const home = homePage();
const WITH_CTA = `s.object({ title: s.string(), subtitle: s.string(), hero: s.string(), cta: s.string() })`;
const SHORT_TITLES = `s.object({ title: s.string().maxLength(12), subtitle: s.string(), hero: s.string() })`;
const CONTENT = {
  title: "Sale",
  subtitle: "Everything must go",
  hero: "a.png",
};

const tree = (files: Files): Files => ({
  ...scaffold([home.file]),
  [home.file]: home.text,
  [HERO]: hero("a"),
  [FOOTER]: footer("x"),
  ...files,
});

const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** `files` as the changes they make over `from`, as content sends a tree. */
function over(
  from: Record<string, string>,
  files: Files,
): Record<string, string | null> {
  const changed: Record<string, string | null> = {};
  for (const [path, text] of Object.entries(files)) {
    if (text !== null && from[path] !== text) changed[path] = text;
  }
  for (const path of Object.keys(from)) {
    if (!(path in files) || files[path] === null) changed[path] = null;
  }
  return changed;
}

const present = (files: Files): Record<string, string> =>
  Object.fromEntries(
    Object.entries(files).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );

/**
 * Content's `merge-trees`: three trees and each one's Source. The Source is
 * what the text holds unless `index` says otherwise -- a site whose build was
 * made before its last content-only publish.
 */
async function contentTrees(
  sides: Record<Side, Files>,
  index: Partial<Record<Side, Record<ModuleFilePath, JSONValue>>> = {},
): Promise<MergeTrees> {
  const site = present(sides.site);
  const base = present(sides.base);
  const modules: MergeTrees["modules"] = {};
  const sources: MergeTrees["sources"] = {};
  for (const side of ["base", "site", "proposal"] as const) {
    const loaded = await loadProject(sides[side]);
    for (const [path, module] of Object.entries(loaded.modules)) {
      const source = index[side]?.[path as ModuleFilePath] ?? module.source;
      sources[sha(source)] = source;
      modules[path] ??= { base: null, site: null, proposal: null };
      modules[path][side] = sha(source);
    }
  }
  return {
    base: "site-1",
    siteHead: "site-2",
    proposalHead: "proposal-1",
    upToDate: false,
    builds: { base: "build-a", site: "build-b" },
    trees: {
      site,
      base: over(site, base),
      proposal: over(base, sides.proposal),
    },
    modules,
    sources,
  };
}

/** The tab: a tree evaluated, and each module's Source checked under what it gave. */
async function evaluate(
  files: Record<string, string>,
  sourceOf: (path: ModuleFilePath) => JSONValue | null,
): Promise<Evaluated> {
  const project = projectOf(files, await loadProject(files));
  const evaluated: Evaluated = {};
  for (const [path, module] of Object.entries(project.modules)) {
    const moduleFilePath = path as ModuleFilePath;
    const source = sourceOf(moduleFilePath) ?? module.source;
    evaluated[moduleFilePath] = {
      schema: module.schema,
      written: module.source,
      errors: module.validate?.(source) ?? [],
    };
  }
  return evaluated;
}

const evaluateSides = async (trees: MergeTrees) => ({
  base: await evaluate(sideFiles(trees, "base"), (p) =>
    sideSource(trees, "base", p),
  ),
  site: await evaluate(sideFiles(trees, "site"), (p) =>
    sideSource(trees, "site", p),
  ),
  proposal: await evaluate(sideFiles(trees, "proposal"), (p) =>
    sideSource(trees, "proposal", p),
  ),
});

/** Both calls, as the tab makes them: merge, evaluate `M`, merge again with it. */
async function update(trees: MergeTrees, resolutions: Resolution[] = []) {
  const evaluated = await evaluateSides(trees);
  const first = updateWithCode({ trees, evaluated, resolutions });
  if (first.status !== "evaluate") return { first, second: first };
  const merged = present({ ...trees.trees.site, ...first.files });
  const second = updateWithCode({
    trees,
    evaluated,
    resolutions,
    merged: {
      id: first.id,
      evaluated: await evaluate(merged, (p) => first.sources[p] ?? null),
    },
  });
  return { first, second };
}

describe("Update from the site, with code", () => {
  test("the site's component, its published title and the proposal's schema all land, in two calls", async () => {
    const trees = await contentTrees(
      {
        base: tree({}),
        // The site's build changed the hero; its index moved on since with a
        // content-only publish, which its build's text does not hold.
        site: tree({ [HERO]: hero("b") }),
        proposal: tree({
          [home.file]: home.withSchema(WITH_CTA, { ...CONTENT, cta: "Buy" }),
        }),
      },
      { site: { [HOME]: { ...CONTENT, title: "Spring sale" } } },
    );

    const { first, second } = await update(trees);

    expect(first).toMatchObject({ status: "evaluate" });
    if (first.status !== "evaluate") return;
    expect(Object.keys(first.files)).toEqual([home.file]);
    expect(first.files[home.file]).toContain("cta: s.string()");
    expect(first.files[home.file]).toContain(`"Spring sale"`);
    expect(second).toEqual({
      status: "merged",
      files: { [home.file]: first.files[home.file] },
      staged: [home.file],
      modules: {
        [HOME]: {
          source: { ...CONTENT, title: "Spring sale", cta: "Buy" },
          schema: expect.objectContaining({ type: "object" }),
        },
      },
    });
  });

  test("a component both changed is a code conflict, and keeping a side settles it", async () => {
    const trees = await contentTrees({
      base: tree({}),
      site: tree({ [HERO]: hero("b") }),
      proposal: tree({ [HERO]: hero("c") }),
    });

    expect((await update(trees)).second).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "code",
          file: HERO,
          base: hero("a"),
          site: hero("b"),
          proposal: hero("c"),
        },
      ],
    });
    expect(
      (await update(trees, [{ file: HERO, keep: "proposal" }])).second,
    ).toMatchObject({
      status: "merged",
      files: { [HERO]: hero("c") },
      staged: [HERO],
    });
  });

  test("a file the proposal held and the merge leaves as the site's is written back, and not staged", async () => {
    const trees = await contentTrees({
      base: tree({}),
      site: tree({ [FOOTER]: footer("y") }),
      proposal: tree({ [FOOTER]: footer("z"), [HERO]: hero("c") }),
    });

    const { second } = await update(trees, [{ file: FOOTER, keep: "site" }]);

    expect(second).toEqual({
      status: "merged",
      files: { [FOOTER]: footer("y"), [HERO]: hero("c") },
      staged: [HERO],
      modules: {},
    });
  });

  test("content the merged schema does not allow is found by evaluating the merge", async () => {
    const trees = await contentTrees(
      {
        base: tree({}),
        site: tree({}),
        proposal: tree({ [home.file]: home.withSchema(SHORT_TITLES, CONTENT) }),
      },
      { site: { [HOME]: { ...CONTENT, title: "The great spring sale" } } },
    );

    const { first, second } = await update(trees);

    expect(first.status).toBe("evaluate");
    expect(second).toMatchObject({
      status: "conflicts",
      conflicts: [
        {
          kind: "invalid",
          moduleFilePath: HOME,
          path: ["title"],
          value: "The great spring sale",
        },
      ],
    });
  });

  test("a custom rule only evaluating can apply is applied: the tab's errors are the ones read", async () => {
    // A `.validate(...)` closure does not serialize, so only the tree's own
    // evaluation knows it.
    const NO_SALES = `s.object({ title: s.string().validate((title) => title.includes("sale") ? "No sales this season" : false), subtitle: s.string(), hero: s.string() })`;
    const trees = await contentTrees(
      {
        base: tree({}),
        site: tree({}),
        proposal: tree({
          [home.file]: home.withSchema(NO_SALES, {
            ...CONTENT,
            title: "Hello",
          }),
        }),
      },
      { site: { [HOME]: { ...CONTENT, subtitle: "Spring sale today" } } },
    );
    // A title written into the merge -- as a person or AI resolving it
    // might -- that the proposal's own rule refuses.
    const { second } = await update(trees, [
      { moduleFilePath: HOME, path: ["title"], value: "Big sale" },
    ]);
    expect(second).toMatchObject({
      status: "conflicts",
      conflicts: [
        {
          kind: "invalid",
          path: ["title"],
          value: "Big sale",
          message: "No sales this season",
        },
      ],
    });
  });

  test("an evaluation of another merge is not committed", async () => {
    const trees = await contentTrees({
      base: tree({}),
      site: tree({ [HERO]: hero("b") }),
      proposal: tree({ [FOOTER]: footer("z") }),
    });
    const evaluated = await evaluateSides(trees);
    expect(
      updateWithCode({
        trees,
        evaluated,
        resolutions: [],
        merged: { id: "another merge", evaluated: evaluated.site },
      }),
    ).toEqual({ status: "stale" });
  });
});
