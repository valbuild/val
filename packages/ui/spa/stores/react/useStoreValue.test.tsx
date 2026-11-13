/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useCallback } from "react";
import {
  createValueStore,
  sameDeep,
  sameFields,
  sameItems,
  sameMembers,
  useKept,
  useLateStoreValue,
  useStoreValue,
} from "./useStoreValue";

/**
 * A reader of a store renders when its ANSWER moves, not when the store does.
 *
 * The hooks these replaced subscribed to a version counter and derived their
 * answer in a `useMemo`, so every reader rendered on every field write to
 * work out the answer it already had -- and the shell read a dozen of them
 * (`docs/plans/studio-write-lag.md`). What is pinned here is the one thing
 * that fixes: a store event that does not move the answer is not a render.
 */
describe("useStoreValue", () => {
  /** A store of numbers; the readers below ask whether it is even. */
  function numberStore(initial: number) {
    const store = createValueStore(initial);
    return store;
  }

  test("does not render its reader when the store moves and the answer does not", () => {
    const store = numberStore(2);
    let renders = 0;
    const isEven = () => store.get() % 2 === 0;
    const hook = renderHook(() => {
      renders += 1;
      return useStoreValue(store.subscribe, isEven);
    });
    expect(hook.result.current).toBe(true);
    const before = renders;
    act(() => store.set(4));
    act(() => store.set(6));
    expect(renders).toBe(before);
    act(() => store.set(7));
    expect(hook.result.current).toBe(false);
    expect(renders).toBe(before + 1);
  });

  test("keeps the object it handed out while a new one says the same", () => {
    const store = createValueStore<string[]>(["a", "b"]);
    let renders = 0;
    const read = () => [...store.get()];
    const hook = renderHook(() => {
      renders += 1;
      return useStoreValue(store.subscribe, read, { isSame: sameItems });
    });
    const first = hook.result.current;
    const before = renders;
    // A new array with the same items: the store moved, the answer did not.
    act(() => store.set(["a", "b"]));
    expect(hook.result.current).toBe(first);
    expect(renders).toBe(before);
    act(() => store.set(["a", "c"]));
    expect(hook.result.current).toEqual(["a", "c"]);
  });

  test("reads only when the version moved", () => {
    const store = createValueStore({ version: 1, value: "one" });
    let reads = 0;
    const read = () => {
      reads += 1;
      return store.get().value;
    };
    const version = () => store.get().version;
    const hook = renderHook(() =>
      useStoreValue(store.subscribe, read, { version }),
    );
    const before = reads;
    // Rendered again, and told of a change that kept the version: not read.
    hook.rerender();
    act(() => store.set({ version: 1, value: "ignored" }));
    expect(reads).toBe(before);
    expect(hook.result.current).toBe("one");
    act(() => store.set({ version: 2, value: "two" }));
    expect(hook.result.current).toBe("two");
  });

  test("answers a new question in the render that asks it", () => {
    const store = createValueStore(10);
    const hook = renderHook(
      ({ add }: { add: number }) => {
        const read = useCallback(() => store.get() + add, [add]);
        // The version did not move, and the question did.
        return useStoreValue(store.subscribe, read, { version: store.get });
      },
      { initialProps: { add: 1 } },
    );
    expect(hook.result.current).toBe(11);
    hook.rerender({ add: 5 });
    expect(hook.result.current).toBe(15);
  });
});

describe("useLateStoreValue", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("reads after the event, once for a burst, and renders only for a new answer", () => {
    const store = createValueStore(1);
    let reads = 0;
    let renders = 0;
    const read = () => {
      reads += 1;
      return store.get() > 2;
    };
    const hook = renderHook(() => {
      renders += 1;
      return useLateStoreValue(store.subscribe, read);
    });
    expect(hook.result.current).toBe(false);
    const readsBefore = reads;
    const rendersBefore = renders;
    act(() => {
      store.set(2);
      store.set(3);
      store.set(4);
    });
    // Nothing is read inside the events themselves
    expect(reads).toBe(readsBefore);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(reads).toBe(readsBefore + 1);
    expect(hook.result.current).toBe(true);
    expect(renders).toBe(rendersBefore + 1);
    // Moved again, to the same answer: read, and not rendered for
    act(() => {
      store.set(5);
      jest.runOnlyPendingTimers();
    });
    expect(reads).toBe(readsBefore + 2);
    expect(renders).toBe(rendersBefore + 1);
  });

  test("drops a read that was scheduled when its reader is gone", () => {
    const store = createValueStore(1);
    let reads = 0;
    const read = () => {
      reads += 1;
      return store.get();
    };
    const hook = renderHook(() => useLateStoreValue(store.subscribe, read));
    const before = reads;
    act(() => store.set(2));
    hook.unmount();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(reads).toBe(before);
  });
});

describe("useKept", () => {
  test("hands back the reference before while the value says the same", () => {
    const hook = renderHook(
      ({ ids }: { ids: string[] }) =>
        useKept(new Set(ids), sameMembers<string>),
      { initialProps: { ids: ["a", "b"] } },
    );
    const first = hook.result.current;
    hook.rerender({ ids: ["b", "a"] });
    expect(hook.result.current).toBe(first);
    hook.rerender({ ids: ["a"] });
    expect(hook.result.current).not.toBe(first);
    expect([...hook.result.current]).toEqual(["a"]);
  });
});

describe("createValueStore", () => {
  test("tells its listeners of a new value, and not of the one it holds", () => {
    const store = createValueStore("a");
    let told = 0;
    const off = store.subscribe(() => {
      told += 1;
    });
    store.set("a");
    expect(told).toBe(0);
    store.set("b");
    expect(told).toBe(1);
    expect(store.get()).toBe("b");
    off();
    store.set("c");
    expect(told).toBe(1);
  });
});

describe("the comparisons", () => {
  test("sameItems is by item and order", () => {
    expect(sameItems([1, 2], [1, 2])).toBe(true);
    expect(sameItems([1, 2], [2, 1])).toBe(false);
    expect(sameItems([1], [1, 2])).toBe(false);
  });

  test("sameMembers is by membership", () => {
    expect(sameMembers(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameMembers(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(sameMembers(new Set([1]), new Set([1, 2]))).toBe(false);
  });

  test("sameFields is one level down", () => {
    const shared = { deep: true };
    expect(sameFields({ a: 1, b: shared }, { a: 1, b: shared })).toBe(true);
    expect(sameFields({ a: 1, b: shared }, { a: 1, b: { deep: true } })).toBe(
      false,
    );
    expect(
      sameFields<{ a: number; b?: number }>({ a: 1 }, { a: 1, b: 2 }),
    ).toBe(false);
  });

  test("sameDeep is by content for plain objects and arrays", () => {
    expect(
      sameDeep(
        { pages: [{ id: "/", hasDraft: true }], count: 1 },
        { pages: [{ id: "/", hasDraft: true }], count: 1 },
      ),
    ).toBe(true);
    expect(
      sameDeep(
        { pages: [{ id: "/", hasDraft: true }] },
        { pages: [{ id: "/", hasDraft: false }] },
      ),
    ).toBe(false);
    expect(sameDeep([1, [2]], [1, [2, 3]])).toBe(false);
    expect(sameDeep({ a: undefined }, {})).toBe(false);
    expect(sameDeep(null, {})).toBe(false);
  });

  test("sameDeep is by identity for anything with a class of its own", () => {
    const when = new Date(0);
    expect(sameDeep({ when }, { when })).toBe(true);
    expect(sameDeep({ when }, { when: new Date(0) })).toBe(false);
    expect(sameDeep(new Map(), new Map())).toBe(false);
    const callback = () => undefined;
    expect(sameDeep({ callback }, { callback })).toBe(true);
    expect(sameDeep({ callback }, { callback: () => undefined })).toBe(false);
  });
});
