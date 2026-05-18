import React from "react";
import { valSuspense } from "./valSuspense";

describe("valSuspense", () => {
  const reactWithUse = React as unknown as {
    use?: <T>(p: Promise<T>) => T;
  };
  const originalUse = reactWithUse.use;

  afterEach(() => {
    if (originalUse === undefined) {
      delete reactWithUse.use;
    } else {
      reactWithUse.use = originalUse;
    }
  });

  it("delegates to React.use when available", () => {
    const calls: unknown[] = [];
    reactWithUse.use = <T>(p: Promise<T>): T => {
      calls.push(p);
      return "from-use" as unknown as T;
    };

    const promise = Promise.resolve("never-read");
    const result = valSuspense(promise);

    expect(result).toBe("from-use");
    expect(calls).toEqual([promise]);
  });

  it("throws the promise when React.use is unavailable", () => {
    delete reactWithUse.use;

    const promise = Promise.resolve("anything");
    let thrown: unknown;
    try {
      valSuspense(promise);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(promise);
  });
});
