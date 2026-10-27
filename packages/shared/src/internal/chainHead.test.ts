import type { PatchId } from "@valbuild/core";
import { chainHeadOf } from "./chainHead";

const ids = (...values: string[]) => values.map((value) => value as PatchId);

test("a reported head wins over the last listed patch", () => {
  expect(chainHeadOf("published" as PatchId, ids("pending"))).toBe("published");
});

test("a reported empty chain is empty, whatever is listed", () => {
  expect(chainHeadOf(null, ids("pending"))).toBeNull();
});

test("no reported head falls back to the last listed patch", () => {
  expect(chainHeadOf(undefined, ids("first", "last"))).toBe("last");
});

test("and to an empty chain when nothing is listed", () => {
  expect(chainHeadOf(undefined, [])).toBeNull();
});
