import { ModuleFilePath } from "@valbuild/core";
import { ValExternalStore } from "./ValOverlayContext";

describe("ValExternalStore.waitForLoad", () => {
  const path = "/content/page.val.ts" as ModuleFilePath;

  it("returns a pre-resolved promise when data already exists", async () => {
    const store = new ValExternalStore();
    // Prime subscriber so get(paths) returns a defined record.
    store.subscribe([path])(() => {});
    store.update(path, { foo: "bar" });

    const promise = store.waitForLoad([path]);
    await expect(promise).resolves.toBeUndefined();
  });

  it("returns the same promise instance for the same paths until resolved", () => {
    const store = new ValExternalStore();
    store.subscribe([path])(() => {});
    const a = store.waitForLoad([path]);
    const b = store.waitForLoad([path]);
    expect(a).toBe(b);
  });

  it("resolves when update() populates the path", async () => {
    const store = new ValExternalStore();
    store.subscribe([path])(() => {});
    const promise = store.waitForLoad([path]);

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    store.update(path, { foo: "bar" });
    await promise;
    expect(resolved).toBe(true);
  });

  it("returns a fresh promise after the previous one resolved", async () => {
    const store = new ValExternalStore();
    store.subscribe([path])(() => {});
    const first = store.waitForLoad([path]);
    store.update(path, { foo: "bar" });
    await first;
    const second = store.waitForLoad([path]);
    // The first one has cleared from the cache; the new call should resolve
    // immediately because data already exists.
    await expect(second).resolves.toBeUndefined();
  });
});

describe("ValExternalStore.get", () => {
  const path = "/content/page.val.ts" as ModuleFilePath;

  it("is undefined before any source has loaded", () => {
    const store = new ValExternalStore();
    expect(store.get([path])).toBeUndefined();
  });

  it("returns data that arrived before a subscription registered", () => {
    // Regression: a suspended first render never commits, so the source can be
    // update()'d before useSyncExternalStore subscribes. get() must still
    // return it (otherwise useValStega falls back to the static source -> 404).
    const store = new ValExternalStore();
    store.update(path, { foo: "bar" });
    expect(store.get([path])).toEqual({ [path]: { foo: "bar" } });
  });

  it("returns a stable reference until a relevant update changes it", () => {
    const store = new ValExternalStore();
    store.update(path, { foo: "bar" });
    const a = store.get([path]);
    const b = store.get([path]);
    expect(a).toBe(b);

    store.update(path, { foo: "baz" });
    const c = store.get([path]);
    expect(c).not.toBe(a);
    expect(c).toEqual({ [path]: { foo: "baz" } });
  });

  it("is unaffected by updates to unrelated paths", () => {
    const store = new ValExternalStore();
    const other = "/content/other.val.ts" as ModuleFilePath;
    store.update(path, { foo: "bar" });
    const a = store.get([path]);
    store.update(other, { unrelated: true });
    expect(store.get([path])).toBe(a);
  });
});
