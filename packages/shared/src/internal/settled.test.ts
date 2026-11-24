import { SettledCache, settledOnce } from "./settled";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a settled value is kept, and handed out in a promise made for each caller", async () => {
  const load = jest.fn(() => Promise.resolve("value"));
  const once = settledOnce(load);
  const first = once();
  expect(await first).toBe("value");
  const second = once();
  expect(second).not.toBe(first);
  expect(await second).toBe("value");
  expect(load).toHaveBeenCalledTimes(1);
});

test("a load still under way is never handed to another caller", async () => {
  const pending = deferred<string>();
  const load = jest
    .fn<Promise<string>, []>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce("second");
  const once = settledOnce(load);
  const first = once();
  // The first caller's load can never settle (its request ended): the
  // second makes its own, and is answered by it.
  expect(await once()).toBe("second");
  expect(load).toHaveBeenCalledTimes(2);
  // And what it settled to is kept for everyone after.
  expect(await once()).toBe("second");
  pending.reject(new Error("the request ended"));
  await expect(first).rejects.toThrow("the request ended");
});

test("a rejection keeps nothing: the next caller loads again", async () => {
  const load = jest
    .fn<Promise<string>, []>()
    .mockRejectedValueOnce(new Error("first failed"))
    .mockResolvedValueOnce("second");
  const once = settledOnce(load);
  await expect(once()).rejects.toThrow("first failed");
  expect(await once()).toBe("second");
});

test("callers in one scope share a load under way; another scope does not", async () => {
  const cache = new SettledCache<string, number>();
  const scope = {};
  const pending = deferred<number>();
  const load = jest.fn(() => pending.promise);
  const a = cache.get("k", load, scope);
  expect(cache.get("k", load, scope)).toBe(a);
  const other = cache.get("k", () => Promise.resolve(2), {});
  expect(await other).toBe(2);
  expect(load).toHaveBeenCalledTimes(1);
  pending.resolve(1);
  expect(await a).toBe(1);
  // The newest settled value is kept.
  expect(cache.peek("k")).toEqual({ value: 1 });
});

test("keep and max decide what is kept", async () => {
  const cache = new SettledCache<string, number>({
    keep: (value) => value > 0,
    max: 1,
  });
  await cache.get("a", () => Promise.resolve(-1));
  expect(cache.peek("a")).toBeUndefined();
  await cache.get("a", () => Promise.resolve(1));
  await cache.get("b", () => Promise.resolve(2));
  expect(cache.peek("a")).toBeUndefined();
  expect(cache.peek("b")).toEqual({ value: 2 });
});
