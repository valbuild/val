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
