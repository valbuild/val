import { buildDataTree, countModules, type ChangedModule } from "./navTree";
import type { CompareNavNode } from "./types";

function changed(moduleFilePath: string): ChangedModule {
  return { moduleFilePath, node: { id: moduleFilePath } };
}

/** The tree as indented text, which is the thing the rule is actually about. */
function draw(nodes: CompareNavNode[], depth = 0): string {
  return nodes
    .flatMap((node) => [
      `${"  ".repeat(depth)}${node.label}`,
      ...(node.children === undefined
        ? []
        : draw(node.children, depth + 1).split("\n")),
    ])
    .filter((line) => line !== "")
    .join("\n");
}

describe("buildDataTree", () => {
  test("a module at the root has no directory above it", () => {
    expect(draw(buildDataTree([changed("/settings.val.ts")]))).toBe("settings");
  });

  test("modules in one directory share it", () => {
    const tree = buildDataTree([
      changed("/content/authors.val.ts"),
      changed("/content/lists.val.ts"),
    ]);

    expect(draw(tree)).toBe(["content", "  authors", "  lists"].join("\n"));
  });

  test("directories sort before modules, each alphabetically", () => {
    // `DataPanel.sortTree`'s order, so the two panels cannot drift apart.
    const tree = buildDataTree([
      changed("/content/zebra.val.ts"),
      changed("/content/alpha.val.ts"),
      changed("/content/shop/items.val.ts"),
    ]);

    expect(draw(tree)).toBe(
      ["content", "  shop", "    items", "  alpha", "  zebra"].join("\n"),
    );
  });

  test("two directories with the same name stay separate", () => {
    // Built by full path, not by segment: `/content/shop` and `/schema/shop`
    // are two directories that happen to share a label.
    const tree = buildDataTree([
      changed("/content/shop/a.val.ts"),
      changed("/schema/shop/b.val.ts"),
    ]);

    expect(draw(tree)).toBe(
      ["content / shop", "  a", "schema / shop", "  b"].join("\n"),
    );
  });
});

/**
 * Compact folders, as VS Code does it.
 *
 * The case it exists for is the one this tree is full of: the nav holds only
 * what changed, so one edit deep in a structured project is otherwise a column
 * of folders with a single child each.
 */
describe("compact folders", () => {
  test("a chain of single-child directories becomes one row", () => {
    const tree = buildDataTree([
      changed("/content/shop/shipping/rates.val.ts"),
    ]);

    expect(draw(tree)).toBe(
      ["content / shop / shipping", "  rates"].join("\n"),
    );
  });

  test("a directory whose only child is a FILE does not merge", () => {
    // `editorial / authors` would read as a path to a directory called
    // `authors`, and would hide where the file stops and its name starts.
    const tree = buildDataTree([changed("/content/editorial/authors.val.ts")]);

    expect(draw(tree)).toBe(["content / editorial", "  authors"].join("\n"));
  });

  test("a directory with two children does not merge", () => {
    const tree = buildDataTree([
      changed("/content/shop/a.val.ts"),
      changed("/content/editorial/b.val.ts"),
    ]);

    expect(draw(tree)).toBe(
      ["content", "  editorial", "    b", "  shop", "    a"].join("\n"),
    );
  });

  test("the merged row takes the DEEPEST directory's id", () => {
    // It is the path the row now stands for. Keeping the outermost id would
    // select and expand something the label does not name.
    const tree = buildDataTree([
      changed("/content/shop/shipping/rates.val.ts"),
    ]);

    expect(tree[0].id).toBe("/content/shop/shipping");
  });

  test("merging happens at every level, not only the root", () => {
    const tree = buildDataTree([
      changed("/content/a.val.ts"),
      changed("/content/deep/deeper/deepest/b.val.ts"),
    ]);

    expect(draw(tree)).toBe(
      ["content", "  deep / deeper / deepest", "    b", "  a"].join("\n"),
    );
  });
});

describe("countModules", () => {
  test("counts modules, not the directories merged above them", () => {
    // A folder's count answers "how many changed things are in here". Counting
    // merged directories would inflate it with rows nobody can click.
    const tree = buildDataTree([
      changed("/content/shop/shipping/rates.val.ts"),
      changed("/content/shop/shipping/zones.val.ts"),
    ]);

    expect(countModules(tree)).toBe(2);
  });
});
