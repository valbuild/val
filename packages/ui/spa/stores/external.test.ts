import { initVal, Internal, type ModuleFilePath } from "@valbuild/core";
import { initTestSystem } from "./testSystem";

/**
 * `.external()` records in the Studio's stores.
 *
 * The design goal is stated as an equality, so most of these tests are written
 * as comparisons with what a `.jsonValues()` record does: once its keys are
 * known, an external record must read exactly like any other record. A reader —
 * a field, a preview, the validation walk — must not be able to tell where the
 * content came from.
 *
 * What is genuinely different is the KEY LIST. A `.jsonValues()` record's keys
 * are in its own source; an external record's source is a marker, so the keys
 * have to be fetched a page at a time, and everything else follows from that.
 */

const PRODUCTS = "/products.val.ts" as ModuleFilePath;

const externalModule = () => {
  const { c, s } = initVal();
  return c.define(
    "/products.val.ts",
    s.record(s.object({ title: s.string() })).external("products"),
    c.external(),
  );
};

describe("an external record's keys", () => {
  it("are NOT in the module — the source is a marker", async () => {
    // The premise of everything below. A `.jsonValues()` module lists its keys
    // and hides only their content; this hides both.
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([externalModule()]);

    const read = await sourceStore.get(`${PRODUCTS}?p=`, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected the record to resolve, got ${read.status}`);
    }
    expect(Internal.isExternal(read.data)).toBe(true);
    dispose();
  });

  it("arrive a page at a time, and the list grows", async () => {
    const { sourceStore, external, dispose } = initTestSystem();
    external.seed(
      PRODUCTS,
      { a: { title: "A" }, b: { title: "B" }, c: { title: "C" } },
      // The store serves two at a time, whatever is asked for — which is the
      // ordinary case for a real one.
      { pageSize: 2 },
    );
    await sourceStore.testReceive([externalModule()]);

    await sourceStore.loadExternalKeys(PRODUCTS);
    expect(sourceStore.externalKeysState(PRODUCTS).keys).toEqual(["a", "b"]);
    expect(sourceStore.externalKeysState(PRODUCTS).cursor).toBe("b");

    await sourceStore.loadExternalKeys(PRODUCTS);
    expect(sourceStore.externalKeysState(PRODUCTS).keys).toEqual([
      "a",
      "b",
      "c",
    ]);
    // Null cursor: that was the last page.
    expect(sourceStore.externalKeysState(PRODUCTS).cursor).toBeNull();
    dispose();
  });

  it("stop being asked for once the store says there are no more", async () => {
    const { sourceStore, external, dispose } = initTestSystem();
    external.seed(PRODUCTS, { a: { title: "A" } });
    await sourceStore.testReceive([externalModule()]);

    await sourceStore.loadExternalKeys(PRODUCTS);
    await sourceStore.loadExternalKeys(PRODUCTS);
    await sourceStore.loadExternalKeys(PRODUCTS);
    // A settled record costs one request, however many times the list re-renders.
    expect(external.keyRequests()).toHaveLength(1);
    dispose();
  });

  it("carry a total, which is not the same as the number loaded", async () => {
    const { sourceStore, external, dispose } = initTestSystem();
    external.seed(
      PRODUCTS,
      { a: { title: "A" }, b: { title: "B" }, c: { title: "C" } },
      { pageSize: 1 },
    );
    await sourceStore.testReceive([externalModule()]);

    await sourceStore.loadExternalKeys(PRODUCTS);
    const state = sourceStore.externalKeysState(PRODUCTS);
    expect(state.keys).toHaveLength(1);
    expect(state.total).toEqual({ count: 3, exact: true });
    dispose();
  });

  it("report a failure without losing what was already loaded", async () => {
    const { sourceStore, external, dispose } = initTestSystem();
    external.seed(
      PRODUCTS,
      { a: { title: "A" }, b: { title: "B" } },
      { pageSize: 1 },
    );
    await sourceStore.testReceive([externalModule()]);
    await sourceStore.loadExternalKeys(PRODUCTS);

    external.failFor(PRODUCTS, "the store is down");
    await sourceStore.loadExternalKeys(PRODUCTS);

    const state = sourceStore.externalKeysState(PRODUCTS);
    expect(state.error).toBe("the store is down");
    // The page that DID load is still there: a failure to fetch more is not a
    // reason to throw away what an editor is looking at.
    expect(state.keys).toEqual(["a"]);
    dispose();
  });
});

describe("once the keys are known, an external record reads like any record", () => {
  const withKeys = async () => {
    const rig = initTestSystem();
    rig.external.seed(PRODUCTS, {
      a: { title: "Anvil" },
      b: { title: "Bucket" },
    });
    await rig.sourceStore.testReceive([externalModule()]);
    await rig.sourceStore.loadExternalKeys(PRODUCTS);
    return rig;
  };

  it("resolves the record to its keys", async () => {
    const { sourceStore, dispose } = await withKeys();
    const read = await sourceStore.get(`${PRODUCTS}?p=`, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected the record to resolve, got ${read.status}`);
    }
    expect(Object.keys(read.data as Record<string, unknown>).sort()).toEqual([
      "a",
      "b",
    ]);
    dispose();
  });

  it("answers the entry path with the MARKER, and a path INSIDE it with entry-missing", async () => {
    // Exactly what a `.jsonValues()` entry does, and for the same reasons. The
    // entry path itself is answered with the marker, because that is what the
    // source holds there and a read of the record's own value must not trigger N
    // fetches. A path descending INTO it is the demand signal, and reporting
    // `entry-missing` is what makes the field hooks fetch and the row render a
    // skeleton.
    const { sourceStore, dispose } = await withKeys();
    expect(sourceStore.peek(`${PRODUCTS}?p="a"`).status).toBe("ready");
    expect(sourceStore.peek(`${PRODUCTS}?p="a"."title"`).status).toBe(
      "entry-missing",
    );
    dispose();
  });

  it("loads entry content, and then reads through to a field inside it", async () => {
    const { sourceStore, dispose } = await withKeys();
    await sourceStore.loadEntries(PRODUCTS, ["a", "b"]);

    const read = await sourceStore.get(`${PRODUCTS}?p="a"."title"`, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected the field to resolve, got ${read.status}`);
    }
    expect(read.data).toBe("Anvil");
    dispose();
  });

  it("asks for a whole window in ONE request", async () => {
    // The endpoint takes an array precisely so a page of rows is one round trip
    // to the store and — where the adapter declares an `around` — one
    // transaction. A request per row would defeat both.
    const { sourceStore, external, dispose } = await withKeys();
    await sourceStore.loadEntries(PRODUCTS, ["a", "b"]);
    expect(external.entryRequests()).toEqual([
      { path: PRODUCTS, keys: ["a", "b"] },
    ]);
    dispose();
  });

  it("does not ask twice for an entry it already has", async () => {
    const { sourceStore, external, dispose } = await withKeys();
    await sourceStore.loadEntries(PRODUCTS, ["a"]);
    await sourceStore.loadEntries(PRODUCTS, ["a", "b"]);
    expect(external.entryRequests().map((r) => r.keys)).toEqual([["a"], ["b"]]);
    dispose();
  });

  it("reports a failed entry per row, and the row can be retried", async () => {
    const { sourceStore, external, dispose } = await withKeys();
    external.failFor(PRODUCTS, "connection reset");
    await sourceStore.loadEntries(PRODUCTS, ["a"]);
    expect(sourceStore.entryError(PRODUCTS, "a")).toBe("connection reset");

    // A failed row stops asking — that is what `entryFailures` is for — until
    // something clears it.
    external.clearFailures();
    await sourceStore.retryEntry(PRODUCTS, "a");
    const read = await sourceStore.get(`${PRODUCTS}?p="a"."title"`, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected the field to resolve, got ${read.status}`);
    }
    expect(read.data).toBe("Anvil");
    dispose();
  });

  it("reads a key the store no longer has as EMPTY, not as loading forever", async () => {
    const { sourceStore, dispose } = await withKeys();
    // `c` was never seeded, so the store answers with nothing for it. `null` is
    // the entry's VALUE, not its absence: the row renders empty rather than
    // spinning for a fetch that has already happened.
    await sourceStore.loadEntries(PRODUCTS, ["c"]);
    const status = sourceStore.peek(`${PRODUCTS}?p="c"."title"`).status;
    expect(status).not.toBe("entry-missing");
    expect(status).not.toBe("entry-loading");
    dispose();
  });
});
