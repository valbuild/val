import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import {
  InMemoryPatchStore,
  ValOpsMemory,
  type ValPatchStore,
} from "./ValOpsMemory";
import type { BaseSha, SchemaSha } from "./ValOps";

const { s, c, config } = initVal();

/**
 * `/stat` is a LONG POLL, and both ways of getting that wrong have shipped.
 *
 * The client sets `wait: 0` between stats unless it has a WebSocket --
 * `useStatus.ts` says so in a comment: "we are long polling so no point in
 * waiting". So the server holding the request open is the only thing pacing it.
 *
 * `ValOpsFS` holds it by racing a 250ms mtime poll and an `fs.watch`. In an
 * isolate neither can observe anything, so it burns CPU for 20s to learn
 * nothing -- which is what this mode exists to stop. The first version of this
 * mode fixed that by answering IMMEDIATELY, and turned a poll every 20s into a
 * request every 6ms. Worse than what it replaced, and it looked like a fix:
 * `/stat` got faster.
 *
 * So there are two properties here and neither alone is the requirement:
 * a stat with nothing to report must NOT return promptly, and a stat must
 * return as soon as something does happen.
 */

const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({
          default: c.define("/content/test.val.ts", s.string(), "hello"),
        }),
    },
  ],
};

const opsWith = (timeoutMs: number) =>
  new ValOpsMemory(valModules, {
    config,
    statPollingInterval: timeoutMs,
    sourceFiles: {
      "/content/test.val.ts": `import { s, c } from "../val.config";\nexport default c.define("/content/test.val.ts", s.string(), "hello");\n`,
    },
  });

/** The shas the client would have been holding, from a first stat. */
async function currentParams(ops: ValOpsMemory) {
  const first = await ops.getStat(null);
  return {
    baseSha: first.baseSha as BaseSha,
    schemaSha: first.schemaSha as SchemaSha,
    patches: "patches" in first ? first.patches : [],
  };
}

describe("ValOpsMemory getStat", () => {
  test("answers a first stat immediately", async () => {
    const ops = opsWith(30_000);
    const started = Date.now();
    const stat = await ops.getStat(null);
    // `null` params is the client asking "what is there", not "tell me when it
    // changes". Parking that would stall the Studio's first paint by 20s.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(stat.type).toBe("did-change");
  });

  test("answers immediately when the client is already behind", async () => {
    const ops = opsWith(30_000);
    const started = Date.now();
    const stat = await ops.getStat({
      baseSha: "stale" as BaseSha,
      schemaSha: "stale" as SchemaSha,
      patches: [],
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(stat.type).toBe("did-change");
  });

  test("HOLDS a stat that has nothing to report", async () => {
    // The regression. Returning promptly here is what made the client issue a
    // request every 6ms, because it waits 0ms before asking again.
    const ops = opsWith(300);
    const params = await currentParams(ops);
    const started = Date.now();
    const stat = await ops.getStat(params);
    const held = Date.now() - started;
    expect(held).toBeGreaterThanOrEqual(250);
    expect(stat.type).toBe("no-change");
  });

  test("returns as soon as a patch is written, without waiting out the timeout", async () => {
    // The other half: holding is only acceptable if a real change cuts it
    // short. A hold that always runs to the timeout would make every edit take
    // 20s to appear in another tab.
    const ops = opsWith(30_000);
    const params = await currentParams(ops);

    const started = Date.now();
    const pending = ops.getStat(params);

    // Through the public write path, so this exercises what the route calls
    // rather than a private notifier.
    setTimeout(() => {
      void ops.createPatch(
        "/content/test.val.ts" as ModuleFilePath,
        [{ op: "replace", path: [], value: "goodbye" }],
        crypto.randomUUID() as PatchId,
        { type: "head", headBaseSha: params.baseSha },
        null,
        null,
      );
    }, 50);

    const stat = await pending;
    const held = Date.now() - started;
    expect(held).toBeLessThan(5_000);
    expect(stat.type).toBe("did-change");
    expect("patches" in stat && stat.patches.length).toBe(1);
  });
});

/**
 * The two ways a signal-parked poll goes wrong, neither of which the tests
 * above can see: one leaves rubbish behind, the other misses the signal.
 *
 * Both were called untestable when they were fixed, on the grounds that the
 * gap they live in is between two private calls. That was wrong twice. The
 * waiter list is reachable by element access, which is what that syntax is
 * for; and the gap itself is openable from outside, because the patch store is
 * an injected dependency and `currentStat()` goes through it.
 */
describe("ValOpsMemory getStat, parked", () => {
  const withStore = (timeoutMs: number, patchStore: ValPatchStore) =>
    new ValOpsMemory(valModules, {
      config,
      statPollingInterval: timeoutMs,
      patchStore,
      sourceFiles: {
        "/content/test.val.ts": `import { s, c } from "../val.config";\nexport default c.define("/content/test.val.ts", s.string(), "hello");\n`,
      },
    });

  test("a waiter that times out does not stay on the list", async () => {
    const ops = opsWith(20);
    const params = await currentParams(ops);
    await ops.getStat(params);
    await ops.getStat(params);
    await ops.getStat(params);
    /*
     * Read directly, because a leak whose only symptom is growth has no
     * black-box symptom to assert. Three polls that each time out used to leave
     * three dead closures here, and on a server that is polled every 20 seconds
     * for as long as it runs, "three" is only where it starts.
     */
    expect(ops["statWaiters"]).toHaveLength(0);
  });

  test("a change announced while it is registering is not missed", async () => {
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let gated = false;
    let entered: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });

    class GatedStore extends InMemoryPatchStore {
      /*
       * Held open once, on the FIRST list after the gate is armed. That call is
       * inside `currentStat()`, which is exactly the gap: the stat has been
       * sampled and the waiter is not registered yet.
       */
      override async list(): Promise<PatchId[]> {
        if (gated) {
          gated = false;
          entered();
          await gate;
        }
        return super.list();
      }
    }

    const ops = withStore(20_000, new GatedStore());
    const params = await currentParams(ops);

    gated = true;
    const started = Date.now();
    const stat = ops.getStat(params);

    await reached;
    // A write lands in the window. `deletePatches` is the public announcer;
    // what matters is that something announced, not what it was.
    await ops.deletePatches([]);
    openGate();

    await stat;
    /*
     * Without the recheck after registration this announcement went to a list
     * the waiter was not on yet, and the request slept the full 20 seconds with
     * the news already in. The interval is deliberately long here so that
     * "returned promptly" cannot pass by accident.
     */
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
