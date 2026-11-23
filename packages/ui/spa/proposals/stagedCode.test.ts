import type { ValModules } from "@valbuild/core";
import {
  resetStagedCode,
  runStagedCode,
  stagedCodeReach,
  type StagedCodeDeps,
} from "./stagedCode";

/*
 * When a write is evaluated, and when its answer waits for that
 * (`stagedCodeReach`, `runStagedCode`). The bundler, the worker and the
 * Studio's stores are the edges here; `codeToolRequests.scenario.test.ts`
 * runs the same through the real stores.
 */

const NAME = "0123456789abcdef0123";
const REGISTRY: ValModules = { config: {}, modules: [] };

/** An evaluation whose bundling the test lets through, one at a time. */
const evaluations = (
  over: {
    dependencies?: Record<string, string[]>;
    bundle?: StagedCodeDeps["bundle"];
  } = {},
) => {
  const release: Array<() => void> = [];
  const record = { started: 0, release };
  const deps: StagedCodeDeps = {
    project: async () => {
      record.started++;
      await new Promise<void>((resolve) => record.release.push(resolve));
      return {
        files: { "val.modules.ts": "", "content/home.val.ts": "" },
        inputs: null,
      };
    },
    bundle:
      over.bundle !== undefined
        ? over.bundle
        : async () => ({
            code: "code",
            ...(over.dependencies !== undefined
              ? { dependencies: over.dependencies }
              : {}),
          }),
    evaluate: async () => ({}),
    importRegistry: async () => REGISTRY,
    reloadCode: async () => ({
      status: "reloaded",
      changed: [],
      removed: [],
      failures: [],
    }),
  };
  return Object.assign(record, { deps });
};
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => resetStagedCode());

describe("evaluations of a proposal's staged code", () => {
  test("run one after another, and a burst waits as ONE behind the one running", async () => {
    const e = evaluations();
    const first = runStagedCode(NAME, e.deps);
    const second = runStagedCode(NAME, e.deps);
    const third = runStagedCode(NAME, e.deps);
    // The two that wait are one evaluation: it reads the project when it
    // starts, after both stagings.
    expect(third).toBe(second);
    expect(second).not.toBe(first);
    await turn();
    expect(e.started).toBe(1);

    e.release[0]();
    await first;
    await turn();
    expect(e.started).toBe(2);
    // One asked for now waits behind the second, which is already reading.
    const fourth = runStagedCode(NAME, e.deps);
    expect(fourth).not.toBe(second);
    e.release[1]();
    await second;
    await turn();
    expect(e.started).toBe(3);
    e.release[2]();
    expect((await fourth).status).toBe("swapped");
  });

  test("another proposal's do not wait for this one's", async () => {
    const e = evaluations();
    void runStagedCode(NAME, e.deps);
    void runStagedCode("f".repeat(20), e.deps);
    await turn();
    expect(e.started).toBe(2);
    for (const release of e.release) release();
  });
});

describe("whether a write can change what the evaluation finds", () => {
  const evaluated = async (over: Parameters<typeof evaluations>[0]) => {
    const e = evaluations(over);
    const done = runStagedCode(NAME, e.deps);
    await turn();
    // A page that cannot run the builder never reads the project.
    e.release[0]?.();
    return done;
  };
  const DEPENDENCIES = {
    "content/home.val.ts": ["val.config.ts", "src/schema/button.ts"],
  };

  test("a Val file always can, whatever was evaluated before", () => {
    for (const path of [
      "content/home.val.ts",
      "/content/home.val.ts",
      "content/posts/first.val.json",
      "val.modules.ts",
      "val.config.ts",
      "src/val.config.ts",
    ]) {
      expect(stagedCodeReach(NAME, ["src/Hero.tsx", path])).toBe("can");
    }
  });

  test("before anything was evaluated here it is not known: evaluated, not waited for", () => {
    expect(stagedCodeReach(NAME, ["src/Hero.tsx"])).toBe("may");
  });

  test("once the bundle said what it reads: a file it reads can, any other cannot", async () => {
    const outcome = await evaluated({ dependencies: DEPENDENCIES });
    expect(outcome).toMatchObject({
      status: "swapped",
      reads: [
        "content/home.val.ts",
        "src/schema/button.ts",
        "val.config.ts",
        "val.modules.ts",
      ],
    });
    expect(stagedCodeReach(NAME, ["src/schema/button.ts"])).toBe("can");
    expect(stagedCodeReach(NAME, ["src/Hero.tsx", "src/app.css"])).toBe(
      "cannot",
    );
    // A file an import of one it reads would also find: which of the two
    // the import names may change.
    for (const path of [
      "src/schema/button.tsx",
      "src/schema/button/index.ts",
      "src/schema/button.js",
    ]) {
      expect(stagedCodeReach(NAME, [path])).toBe("may");
    }
    // What decides which file an import names may change what it reads.
    expect(stagedCodeReach(NAME, ["tsconfig.json"])).toBe("may");
    expect(stagedCodeReach(NAME, ["package.json"])).toBe("may");
    // Another proposal's evaluation says nothing of this one.
    expect(stagedCodeReach("f".repeat(20), ["src/Hero.tsx"])).toBe("may");
  });

  test("a bundler that does not say what it reads leaves it not known", async () => {
    await evaluated({});
    expect(stagedCodeReach(NAME, ["src/Hero.tsx"])).toBe("may");
  });

  test("while one is under way, its bundle may reach further than the last one's", async () => {
    await evaluated({ dependencies: DEPENDENCIES });
    const e = evaluations({ dependencies: DEPENDENCIES });
    const running = runStagedCode(NAME, e.deps);
    expect(stagedCodeReach(NAME, ["src/Hero.tsx"])).toBe("may");
    await turn();
    e.release[0]();
    await running;
    expect(stagedCodeReach(NAME, ["src/Hero.tsx"])).toBe("cannot");
  });

  test("while the staged code does not evaluate, any write may be the fix: it is waited for", async () => {
    const outcome = await evaluated({
      bundle: async () => {
        throw new Error("'./button' could not be resolved");
      },
    });
    expect(outcome.status).toBe("does-not-evaluate");
    expect(stagedCodeReach(NAME, ["src/Hero.tsx"])).toBe("can");
  });

  test("a page that cannot run the builder evaluates nothing: only a Val file's write says so", async () => {
    const outcome = await evaluated({ bundle: null });
    expect(outcome.status).toBe("not-here");
    expect(stagedCodeReach(NAME, ["src/Hero.tsx"])).toBe("cannot");
    expect(stagedCodeReach(NAME, ["content/home.val.ts"])).toBe("can");
  });
});
