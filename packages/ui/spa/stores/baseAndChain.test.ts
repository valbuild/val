import {
  computeSourcesSha,
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem } from "./createSystem";
import type { FetchPatches } from "./PatchStore";
import type { PatchRecord } from "./types";

/**
 * The Studio shows BASE + CHAIN, and the two have to come from the same build.
 *
 * The base is the val modules in the bundle the Studio loaded -- the build that
 * served its page. The chain is whatever `/stat` announces, and `/stat` answers
 * relative to the build that answered IT: the patches that build does not
 * contain. After a publish those can be two different builds for a while (the
 * platform's pointer lags by about a minute per location, and a Studio tab
 * opened before the publish keeps its bundle until reloaded), and neither half
 * knows about the other.
 *
 * The rule the Studio has to follow: a patch is applied if and only if the base
 * it is applied to does not already contain it. What must come out is always
 * the head's content plus the pending edits -- never an edit missing, never one
 * applied twice.
 *
 * The chain is array ops on purpose. A `replace` applied twice or skipped once
 * can look right; a `move` or a `remove` cannot.
 *
 * Commits, in order:
 *   C0  the seed:   [a, b, c, d]
 *   C1  published:  move a to the end   -> [b, c, d, a]
 *   C2  published:  remove index 0      -> [c, d, a]
 *   --  pending:    add "z" at the end  -> [c, d, a, z]   <- what must show
 */

// Branded ids, by guard rather than assertion: each guard checks the shape it
// claims, so a typo in a fixture fails here rather than in the store.
const isModuleFilePath = (path: string): path is ModuleFilePath =>
  path.startsWith("/") && path.endsWith(".val.ts");
const isSourcePath = (path: string): path is SourcePath =>
  /^\/.+\.val\.ts(\?p=.*)?$/.test(path);
const isPatchId = (id: string): id is PatchId => id.length > 0;
function brand<T extends string>(
  value: string,
  guard: (value: string) => value is T,
): T {
  if (!guard(value)) throw new Error(`not a valid id: ${value}`);
  return value;
}

const MODULE = brand("/lists.val.ts", isModuleFilePath);
const KEYWORDS = brand('/lists.val.ts?p="keywords"', isSourcePath);

type Commit = "C0" | "C1" | "C2";
const COMMITS: Commit[] = ["C0", "C1", "C2"];

/** What each build's bundle has as its source, i.e. content at that commit. */
const CONTENT_AT: Record<Commit, string[]> = {
  C0: ["a", "b", "c", "d"],
  C1: ["b", "c", "d", "a"],
  C2: ["c", "d", "a"],
};
const HEAD_PLUS_PENDING = ["c", "d", "a", "z"];

const record = (
  patchId: string,
  patch: PatchRecord["patch"],
  appliedAt: Commit | null,
): PatchRecord => ({
  patchId: brand(patchId, isPatchId),
  moduleFilePath: MODULE,
  patch,
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "someone",
  appliedAt: appliedAt === null ? null : { commitSha: appliedAt },
});

/** The whole chain as content holds it, in order. */
const CHAIN: { record: PatchRecord; committedIn: Commit | null }[] = [
  {
    record: record(
      "p1",
      [{ op: "move", from: ["keywords", "0"], path: ["keywords", "3"] }],
      "C1",
    ),
    committedIn: "C1",
  },
  {
    record: record("p2", [{ op: "remove", path: ["keywords", "0"] }], "C2"),
    committedIn: "C2",
  },
  {
    record: record(
      "p3",
      [{ op: "add", path: ["keywords", "3"], value: "z" }],
      null,
    ),
    committedIn: null,
  },
];

/** `GET /patches`, as content answers it: every record it was asked for. */
const fetchFromContent: FetchPatches = async (patchIds) => ({
  patches: CHAIN.map(({ record }) => record).filter((record) =>
    patchIds.includes(record.patchId),
  ),
});

/** The `sourcesSha` a build at `commit` reports: the fold over its source. */
const sourcesShaAt = (commit: Commit) =>
  computeSourcesSha([
    { path: MODULE, source: { keywords: CONTENT_AT[commit] } },
  ]);

/**
 * What content answers a build at `commit`: the patches it does not contain.
 * Those committed after it, and the pending ones -- as `/applicable/patches`
 * does for a build that names its commit. And which build it is, as `/stat`
 * says with `sourcesSha`.
 */
function statFor(commit: Commit) {
  const after = COMMITS.indexOf(commit);
  const applicable = CHAIN.filter(
    ({ committedIn }) =>
      committedIn === null || COMMITS.indexOf(committedIn) > after,
  );
  return {
    patches: applicable.map(({ record }) => record.patchId),
    appliedPatches: applicable
      .filter(({ committedIn }) => committedIn !== null)
      .map(({ record }) => record.patchId),
    baseSha: `sources-at-${commit}`,
    sourcesSha: sourcesShaAt(commit),
  };
}

function studioOnBundle(
  bundle: Commit,
  options: { fetchPatches?: FetchPatches } = {},
) {
  const { c, s } = initVal();
  const baseFetches: string[] = [];
  let created = 0;
  const system = createSystem({
    // `PUT /sources/~?apply_patches=false`, answered by the build whose sha is
    // asked for: the base that build's chain is relative to.
    fetchBaseSources: async (sourcesSha) => {
      baseFetches.push(sourcesSha);
      const commit = COMMITS.find((at) => sourcesShaAt(at) === sourcesSha);
      if (commit === undefined) return null;
      return {
        sourcesSha,
        sources: { [MODULE]: { keywords: CONTENT_AT[commit] } },
      };
    },
    fetchPatches: options.fetchPatches ?? fetchFromContent,
    createPatchId: () => brand(`local-${++created}`, isPatchId),
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    publishPatches: async () => ({ status: "published" }),
  });
  system.host.receive([
    c.define(MODULE, s.object({ keywords: s.array(s.string()) }), {
      keywords: CONTENT_AT[bundle],
    }),
  ]);
  return Object.assign(system, { baseFetches });
}

const settle = async (system: ReturnType<typeof studioOnBundle>) => {
  await system.patchSync.flush();
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("the Studio's base and chain, when two builds answer", () => {
  for (const bundle of COMMITS) {
    for (const answeredBy of COMMITS) {
      const mixed = bundle !== answeredBy;
      test(`bundle built at ${bundle}, /stat answered by the build at ${answeredBy}${
        mixed ? " (mixed)" : ""
      }`, async () => {
        const system = studioOnBundle(bundle);
        system.stat.receiveStat(statFor(answeredBy));
        await settle(system);

        expect(system.sourceStore.peek(KEYWORDS)).toMatchObject({
          data: HEAD_PLUS_PENDING,
        });
      });
    }
  }
});

/**
 * The same rule over TIME, which is what an open Studio sees: one build answers,
 * then another. Every value a reader could be handed along the way is recorded,
 * because a Studio that ends up right after showing the wrong list for a moment
 * is the bug as the user saw it -- the settled value alone would not catch it.
 */
describe("the Studio's base and chain, when the answering build changes", () => {
  // Sampled at the end of the turn that announced the change, which is the
  // earliest a render can read: React answers a store notification by
  // scheduling a render, never inside the notification. A value that exists
  // only between two writes of one synchronous step is never on screen; one
  // that survives to the end of a turn is.
  const observe = (system: ReturnType<typeof studioOnBundle>) => {
    const seen: unknown[] = [];
    system.sourceStore.events.on("source:change", () => {
      queueMicrotask(() => {
        const peeked = system.sourceStore.peek(KEYWORDS);
        seen.push("data" in peeked ? peeked.data : peeked.status);
      });
    });
    return seen;
  };

  const transitions: [Commit, Commit][] = [
    ["C0", "C2"],
    ["C2", "C0"],
    ["C1", "C2"],
    ["C0", "C1"],
  ];
  for (const [from, to] of transitions) {
    test(`on the ${from} bundle, /stat from ${from} and then from ${to}`, async () => {
      const system = studioOnBundle(from);
      system.stat.receiveStat(statFor(from));
      await settle(system);
      expect(system.sourceStore.peek(KEYWORDS)).toMatchObject({
        data: HEAD_PLUS_PENDING,
      });

      const seen = observe(system);
      system.stat.receiveStat(statFor(to));
      await settle(system);

      expect(system.sourceStore.peek(KEYWORDS)).toMatchObject({
        data: HEAD_PLUS_PENDING,
      });
      for (const value of seen) {
        expect(value).toEqual(HEAD_PLUS_PENDING);
      }
    });
  }

  test("and back to the bundle's own build, with no fetch", async () => {
    const system = studioOnBundle("C0");
    system.stat.receiveStat(statFor("C2"));
    await settle(system);
    const seen = observe(system);
    system.stat.receiveStat(statFor("C0"));
    await settle(system);

    expect(system.sourceStore.peek(KEYWORDS)).toMatchObject({
      data: HEAD_PLUS_PENDING,
    });
    for (const value of seen) {
      expect(value).toEqual(HEAD_PLUS_PENDING);
    }
    // One fetch, for C2's base. C0's is the bundle's own, and is kept.
    expect(system.baseFetches).toEqual([sourcesShaAt("C2")]);
  });

  test("a stat from the bundle's own build fetches nothing", async () => {
    const system = studioOnBundle("C1");
    system.stat.receiveStat(statFor("C1"));
    await settle(system);
    expect(system.baseFetches).toEqual([]);
  });

  test("a newer stat overtakes one still fetching its base", async () => {
    const system = studioOnBundle("C0");
    // C2's base is fetched; before it lands, C0 answers again. C0 is the newer
    // answer, and the one to believe.
    system.stat.receiveStat(statFor("C2"));
    system.stat.receiveStat(statFor("C0"));
    await settle(system);
    expect(system.sourceStore.peek(KEYWORDS)).toMatchObject({
      data: HEAD_PLUS_PENDING,
    });
    expect(system.stat.currentPatchIds()).toEqual(statFor("C0").patches);
  });
});

/**
 * The three ways the swap could leave a hole in the chain, each found in
 * review. In each, the chain the new base gets must be the whole chain.
 */
describe("the swap never rebases onto a chain with a hole in it", () => {
  const peekKeywords = (system: ReturnType<typeof studioOnBundle>) => {
    const peeked = system.sourceStore.peek(KEYWORDS);
    return "data" in peeked ? peeked.data : peeked.status;
  };

  test("a record the server did not send holds the stat back, and the next one lands", async () => {
    // The C2 bundle holds p3. A stat from C0 needs p1 and p2 as well, and the
    // first fetch comes back without p1.
    let dropP1 = true;
    const system = studioOnBundle("C2", {
      fetchPatches: async (patchIds) => {
        const res = await fetchFromContent(patchIds);
        if (!dropP1 || !patchIds.some((id) => id === "p1")) return res;
        dropP1 = false;
        return {
          patches: res.patches.filter((record) => record.patchId !== "p1"),
        };
      },
    });
    system.stat.receiveStat(statFor("C2"));
    await settle(system);
    system.stat.receiveStat(statFor("C0"));
    await settle(system);
    // Not rebased onto C0 with p1 missing -- which would show [b, c, z, a, d]
    // minus a move, and never recover. Still C2 + p3.
    expect(peekKeywords(system)).toEqual(HEAD_PLUS_PENDING);
    expect(system.stat.currentPatchIds()).toEqual(statFor("C2").patches);

    system.stat.receiveStat(statFor("C0"));
    await settle(system);
    expect(peekKeywords(system)).toEqual(HEAD_PLUS_PENDING);
    expect(system.stat.currentPatchIds()).toEqual(statFor("C0").patches);
  });

  test("a fetch already running is waited for, not counted as done", async () => {
    // A stat from the bundle's own build starts fetching p3 the ordinary way;
    // before it answers, a stat from C0 arrives and needs p3 too.
    const answers: (() => void)[] = [];
    const system = studioOnBundle("C2", {
      fetchPatches: async (patchIds) => {
        await new Promise<void>((resolve) => answers.push(resolve));
        return fetchFromContent(patchIds);
      },
    });
    const seen: unknown[] = [];
    system.sourceStore.events.on("source:change", () => {
      queueMicrotask(() => seen.push(peekKeywords(system)));
    });
    system.stat.receiveStat(statFor("C2"));
    system.stat.receiveStat(statFor("C0"));
    for (let i = 0; i < 10 && answers.length > 0; i++) {
      // Newest first: the staging fetch answers while the ordinary one is
      // still out, which is the order that exposes a fetch counted as done.
      answers.pop()?.();
      await settle(system);
    }
    await settle(system);

    // And the stat from C0 is ADOPTED, rather than held back as incomplete:
    // the record was on its way, not missing.
    expect(system.stat.currentPatchIds()).toEqual(statFor("C0").patches);
    expect(peekKeywords(system)).toEqual(HEAD_PLUS_PENDING);
    // Nothing after the first value that is on screen for C0 may be missing p3:
    // the base and a chain without it is the flash.
    const afterSwap = seen.slice(seen.findIndex((v) => Array.isArray(v)));
    for (const value of afterSwap) {
      expect(value).toEqual(HEAD_PLUS_PENDING);
    }
  });

  test("a saved edit a stale stat has not caught up with survives the swap", async () => {
    const system = studioOnBundle("C0");
    system.stat.receiveStat(statFor("C0"));
    await settle(system);
    const created = await system.patchStore.createPatch(MODULE, [
      { op: "add", path: ["keywords", "4"], value: "y" },
    ]);
    if (!("record" in created)) throw new Error("createPatch failed");
    await settle(system);
    expect(peekKeywords(system)).toEqual([...HEAD_PLUS_PENDING, "y"]);

    // From C2, and too old to name the edit that was just saved.
    system.stat.receiveStat(statFor("C2"));
    await settle(system);
    expect(peekKeywords(system)).toEqual([...HEAD_PLUS_PENDING, "y"]);
  });

  test("a fetch that throws is asked for again by the next stat", async () => {
    let throwOnce = true;
    const system = studioOnBundle("C2", {
      fetchPatches: async (patchIds) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("the network blinked");
        }
        return fetchFromContent(patchIds);
      },
    });
    system.stat.receiveStat(statFor("C2"));
    await settle(system);
    system.stat.receiveStat(statFor("C2"));
    await settle(system);
    expect(peekKeywords(system)).toEqual(HEAD_PLUS_PENDING);
  });

  test("a staging fetch that throws holds the stat back instead of losing it", async () => {
    let throwOnce = true;
    const failing = studioOnBundle("C2", {
      fetchPatches: async (patchIds) => {
        if (throwOnce && patchIds.some((id) => id === "p1")) {
          throwOnce = false;
          throw new Error("the network blinked");
        }
        return fetchFromContent(patchIds);
      },
    });
    failing.stat.receiveStat(statFor("C2"));
    await settle(failing);
    failing.stat.receiveStat(statFor("C0"));
    await settle(failing);
    // Held back, not rebased with a hole and not stuck on a rejection.
    expect(peekKeywords(failing)).toEqual(HEAD_PLUS_PENDING);
    expect(failing.stat.currentPatchIds()).toEqual(statFor("C2").patches);
    failing.stat.receiveStat(statFor("C0"));
    await settle(failing);
    expect(peekKeywords(failing)).toEqual(HEAD_PLUS_PENDING);
    expect(failing.stat.currentPatchIds()).toEqual(statFor("C0").patches);
  });
});
