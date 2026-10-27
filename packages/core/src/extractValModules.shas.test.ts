import { initVal } from "./initVal";
import {
  computeValModuleShas,
  extractValModules,
  type ValModuleShaEntry,
} from "./extractValModules";
import type { ModuleFilePath } from "./val";
import type { Source } from "./source";

const { s, c, config } = initVal();

/**
 * The SHAs are a fold, and something other than extraction has to be able to
 * reproduce it.
 *
 * The server promotes the sources it has just written to disk rather than
 * re-evaluating the modules — a module `def` is the app's own `import()`, which
 * resolves from the module registry and not from the file that was just
 * rewritten, so re-extracting gets the OLD content back. Promoting means folding
 * the SHAs again over entries the fold produced the first time, so that fold has
 * to be replayable to the bit.
 */
const modules = () => ({
  config,
  modules: [
    {
      def: async () => ({
        default: c.define("/a.val.ts", s.object({ title: s.string() }), {
          title: "a",
        }),
      }),
    },
    {
      def: async () => ({
        default: c.define("/b.val.ts", s.object({ title: s.string() }), {
          title: "b",
        }),
      }),
    },
  ],
});

const withSource = (
  entries: readonly ValModuleShaEntry[],
  path: string,
  source: Source,
): ValModuleShaEntry[] =>
  entries.map((entry) =>
    entry.path === (path as ModuleFilePath) ? { ...entry, source } : entry,
  );

describe("the module SHA fold", () => {
  it("reproduces itself from the entries it recorded", async () => {
    const extracted = await extractValModules(modules());

    const again = computeValModuleShas(
      config,
      extracted.shaEntries,
      extracted.moduleErrors,
    );

    expect(again).toEqual({
      baseSha: extracted.baseSha,
      schemaSha: extracted.schemaSha,
      sourcesSha: extracted.sourcesSha,
      configSha: extracted.configSha,
    });
  });

  it("moves the source SHAs when one module's source moves, and nothing else", async () => {
    const extracted = await extractValModules(modules());

    const moved = computeValModuleShas(
      config,
      withSource(extracted.shaEntries, "/a.val.ts", { title: "published" }),
      extracted.moduleErrors,
    );

    expect(moved.sourcesSha).not.toBe(extracted.sourcesSha);
    expect(moved.baseSha).not.toBe(extracted.baseSha);
    // The schemas did not move, and the client refetches `/schema` on this one.
    expect(moved.schemaSha).toBe(extracted.schemaSha);
    expect(moved.configSha).toBe(extracted.configSha);
  });

  /**
   * The fold is ORDER-dependent, which is why the entries are a list and not a
   * record keyed by path. A record would leave this to insertion order, which
   * nothing in the type promises.
   */
  it("depends on the order the modules are folded in", async () => {
    const extracted = await extractValModules(modules());

    const reversed = computeValModuleShas(
      config,
      [...extracted.shaEntries].reverse(),
      extracted.moduleErrors,
    );

    expect(reversed.sourcesSha).not.toBe(extracted.sourcesSha);
  });

  /**
   * A module that fails to load changes the base SHA of every module folded in
   * AFTER it and of none before, because the error array is mixed in as it
   * stands at each step. `moduleErrorsAt` is what carries that, and getting it
   * wrong would make a promotion look like a change on any project with a broken
   * module.
   */
  it("mixes in only the errors collected before each module", async () => {
    const broken = {
      config,
      modules: [
        modules().modules[0],
        { def: async () => Promise.reject(new Error("boom")) },
        modules().modules[1],
      ],
    };
    const extracted = await extractValModules(broken);
    expect(extracted.moduleErrors).toHaveLength(1);
    expect(extracted.shaEntries.map((entry) => entry.moduleErrorsAt)).toEqual([
      0, 1,
    ]);

    // And the replay is still exact with the error in place.
    expect(
      computeValModuleShas(config, extracted.shaEntries, extracted.moduleErrors)
        .baseSha,
    ).toBe(extracted.baseSha);
  });
});
