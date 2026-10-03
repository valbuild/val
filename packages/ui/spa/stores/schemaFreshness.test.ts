import {
  extractValModules,
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import { createSystem } from "./createSystem";
import { SCHEMA_DISAGREEMENT_GRACE_MS } from "./SchemaFreshnessWatch";
import { statSnapshotOf, type StatResponseJson } from "./react/statSnapshotOf";

/**
 * A Studio open across a schema deploy is told to reload.
 *
 * The one thing a reload is allowed to change is the schema, and then the user
 * has to be asked rather than left editing against a shape that has been
 * replaced. The dialog for it existed and nothing reported to it. These pin the
 * reporting, and the two rules that keep it from ever asking for a reload that
 * would not help: not until the page's schema and the server's have agreed
 * once, and not for a disagreement that resolves itself within the grace
 * period.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;

function before(): ValModule<SelectorSource>[] {
  const { c, s } = initVal();
  return [c.define(MODULE, s.object({ title: s.string() }), { title: "t" })];
}

function after(): ValModule<SelectorSource>[] {
  const { c, s } = initVal();
  return [
    c.define(
      MODULE,
      s.object({ title: s.string(), subtitle: s.string().nullable() }),
      { title: "t", subtitle: null },
    ),
  ];
}

/** What the SERVER reports for a build of these modules. */
async function servedSchemaSha(
  modules: ValModule<SelectorSource>[],
): Promise<string> {
  const { config } = initVal();
  const extracted = await extractValModules({
    config,
    modules: modules.map((module) => ({
      def: async () => ({ default: module }),
    })),
  });
  return extracted.schemaSha;
}

function makeSystem() {
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
  });
  return system;
}

function stat(system: ReturnType<typeof makeSystem>, schemaSha?: string) {
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    ...(schemaSha !== undefined ? { schemaSha } : {}),
  });
}

function freshness(system: ReturnType<typeof makeSystem>) {
  return system.status.current().schema;
}

let oldSha: string;
let newSha: string;

beforeAll(async () => {
  oldSha = await servedSchemaSha(before());
  newSha = await servedSchemaSha(after());
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("the page folds its schemas exactly as the server does", () => {
  // Everything below depends on this. If the two disagreed, no stat would
  // ever agree with the page and the watch would never report anything.
  const system = makeSystem();
  system.host.receive(before());
  expect(system.host.schemaSha()).toBe(oldSha);
  expect(oldSha).not.toBe(newSha);
});

test("a schema deployed under an open page asks for a reload", () => {
  const system = makeSystem();
  system.host.receive(before());
  stat(system, oldSha);
  expect(freshness(system)).toBe("current");

  stat(system, newSha);
  // Not at once: see the HMR test below.
  expect(freshness(system)).toBe("current");
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS);

  expect(freshness(system)).toBe("out-of-date");
});

test("a page that never agreed with the server is not asked to reload", () => {
  /*
   * A new bundle answered by a build that has not caught up, or a fold that
   * differs for a reason that is not a deploy. Either way a reload loads the
   * same thing and is answered the same way — so asking for one would be a
   * dialog that reloads into itself.
   */
  const system = makeSystem();
  system.host.receive(after());
  stat(system, oldSha);
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS * 10);

  expect(freshness(system)).toBe("current");

  // And once the server catches up, the page is armed for the next deploy.
  stat(system, newSha);
  stat(system, oldSha);
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS);
  expect(freshness(system)).toBe("out-of-date");
});

test("a schema the page picks up by itself, as HMR does in dev, asks for nothing", () => {
  const system = makeSystem();
  system.host.receive(before());
  stat(system, oldSha);

  // The server sees the edit first, and the page's re-intake follows.
  stat(system, newSha);
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS / 2);
  system.host.receive(after());
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS * 2);

  expect(freshness(system)).toBe("current");
});

test("a build that answers once and is replaced within the grace asks for nothing", () => {
  const system = makeSystem();
  system.host.receive(before());
  stat(system, oldSha);

  stat(system, newSha);
  stat(system, oldSha);
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS * 2);

  expect(freshness(system)).toBe("current");
});

test("a server that does not report a schema is never taken as a new one", () => {
  const system = makeSystem();
  system.host.receive(before());
  stat(system, oldSha);
  stat(system);
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS * 2);

  expect(freshness(system)).toBe("current");
});

test("a stat dropped as older is not believed about its schema", () => {
  /*
   * `/stat` has more than one caller, so an answer from before a deploy can
   * land after one from after it. Believed, it would name the old schema to a
   * page that has just reloaded into the new one — and ask it to reload again.
   */
  const system = makeSystem();
  system.host.receive(after());
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 2,
    schemaSha: newSha,
  });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 1,
    schemaSha: oldSha,
  });
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS * 2);

  expect(freshness(system)).toBe("current");
});

test("a stat read by the conflict re-sync carries the schema too", () => {
  /*
   * A save that hits a moved head re-syncs with its own `/stat`, outside the
   * provider's poll. That is often how a client first meets a server that has
   * been redeployed — the websocket message was missed, and the next poll can
   * be twenty minutes away — so it has to carry `schemaSha` like any other.
   */
  const system = makeSystem();
  system.host.receive(before());
  stat(system, oldSha);

  const json: StatResponseJson = {
    type: "use-websocket",
    url: "wss://example",
    nonce: "n",
    baseSha: "sha",
    sourcesSha: "sources",
    schemaSha: newSha,
    commits: [],
    deployments: [],
    patches: [],
    appliedPatches: [],
    profileId: null,
    mode: "http",
    config: {},
  };
  system.stat.receiveStat(statSnapshotOf(json));
  jest.advanceTimersByTime(SCHEMA_DISAGREEMENT_GRACE_MS);

  expect(freshness(system)).toBe("out-of-date");
});

/**
 * During a deploy the old build and the new one both answer `/stat`, at the
 * same chain version, and from more than one caller — so the answer that lands
 * LAST is not the newest. A fresh read when the grace is up settles it.
 */
function makeAskingSystem(served: () => string) {
  const reads: number[] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
    readServedSchemaSha: async () => {
      reads.push(Date.now());
      return served();
    },
  });
  return Object.assign(system, { reads });
}

async function graceAndRead() {
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS);
}

test("a late answer from the old build does not ask a reloaded page to reload again", async () => {
  // This page reloaded into the new schema; the server now runs it.
  const system = makeAskingSystem(() => newSha);
  system.host.receive(after());
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: newSha,
  });
  // An answer the old build gave, at the same chain version, lands after.
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: oldSha,
  });
  await graceAndRead();

  expect(system.reads).toHaveLength(1);
  expect(freshness(system)).toBe("current");
});

test("a late answer from the old build does not hide a deploy", async () => {
  const system = makeAskingSystem(() => newSha);
  system.host.receive(before());
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: oldSha,
  });
  // The new build answers, then a request the old build was still serving.
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: newSha,
  });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: oldSha,
  });
  await graceAndRead();

  expect(freshness(system)).toBe("out-of-date");
});

test("with a fresh read, HMR catching up within the grace still asks for nothing", async () => {
  const system = makeAskingSystem(() => newSha);
  system.host.receive(before());
  stat(system, oldSha);

  stat(system, newSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS / 2);
  system.host.receive(after());
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 2);

  expect(freshness(system)).toBe("current");
});

test("a page that agrees with the server asks nothing", async () => {
  const system = makeAskingSystem(() => oldSha);
  system.host.receive(before());
  stat(system, oldSha);
  stat(system, oldSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 2);

  expect(system.reads).toHaveLength(0);
  expect(freshness(system)).toBe("current");
});

test("a fresh read that fails is no answer: the late old build still asks for nothing", async () => {
  // The read fails twice, then answers with the schema the page runs.
  const answers: (() => string)[] = [
    () => {
      throw new Error("503");
    },
    () => {
      throw new Error("network");
    },
    () => newSha,
  ];
  const system = makeAskingSystem(() => {
    const next = answers.shift();
    if (next === undefined) throw new Error("asked too often");
    return next();
  });
  system.host.receive(after());
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: newSha,
  });
  system.stat.receiveStat({
    patches: [],
    baseSha: "sha",
    headVersion: 4,
    schemaSha: oldSha,
  });
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 20);

  expect(system.reads).toHaveLength(3);
  expect(freshness(system)).toBe("current");
});

test("a deploy behind failing reads is still reported once a read answers", async () => {
  let failing = true;
  const system = makeAskingSystem(() => {
    if (failing) throw new Error("503");
    return newSha;
  });
  system.host.receive(before());
  stat(system, oldSha);
  stat(system, newSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 4);
  expect(freshness(system)).toBe("current");

  failing = false;
  await jest.advanceTimersByTimeAsync(60_000);

  expect(freshness(system)).toBe("out-of-date");
});

test("fresh reads go one at a time, and a change while one is out asks again", async () => {
  const answers: ((sha: string) => void)[] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
    readServedSchemaSha: () =>
      new Promise<string>((resolve) => answers.push(resolve)),
  });
  system.host.receive(after());
  const at = (schemaSha: string) =>
    system.stat.receiveStat({
      patches: [],
      baseSha: "sha",
      headVersion: 4,
      schemaSha,
    });
  at(newSha);
  at(oldSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS);
  expect(answers).toHaveLength(1);

  // While that read is out, the cached answer moves again, and again.
  at(newSha);
  at(oldSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 4);
  expect(answers).toHaveLength(1);

  // Its answer cannot decide: it was asked before what came after it.
  answers[0](newSha);
  await jest.advanceTimersByTimeAsync(0);
  expect(answers).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS);
  expect(answers).toHaveLength(2);
  answers[1](newSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 4);

  expect(answers).toHaveLength(2);
  expect(freshness(system)).toBe("current");
});

test("a rollback to the schema of a late answer is still reported", async () => {
  // The server runs the new schema, then is rolled back to the old one.
  let served = newSha;
  const system = makeAskingSystem(() => served);
  system.host.receive(after());
  const at = (schemaSha: string) =>
    system.stat.receiveStat({
      patches: [],
      baseSha: "sha",
      headVersion: 4,
      schemaSha,
    });
  at(newSha);
  // A late answer from the old build, settled by a fresh read.
  at(oldSha);
  await graceAndRead();
  expect(freshness(system)).toBe("current");

  // The rollback. Its stat names the old schema — which is what the cache
  // held, had the fresh read not put the new one back.
  served = oldSha;
  at(oldSha);
  await graceAndRead();

  expect(freshness(system)).toBe("out-of-date");
});

test("a read still out when the system is disposed reports nothing", async () => {
  const answers: ((sha: string) => void)[] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
    readServedSchemaSha: () =>
      new Promise<string>((resolve) => answers.push(resolve)),
  });
  system.host.receive(before());
  stat(system, oldSha);
  stat(system, newSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS);
  expect(answers).toHaveLength(1);

  system.dispose();
  answers[0](newSha);
  await jest.advanceTimersByTimeAsync(SCHEMA_DISAGREEMENT_GRACE_MS * 20);

  expect(freshness(system)).toBe("current");
  expect(answers).toHaveLength(1);
});
