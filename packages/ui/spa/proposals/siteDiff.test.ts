import { sameJson } from "./siteDiff";

test("JSON equality ignores key order and nothing else", () => {
  expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(
    true,
  );
  expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(sameJson([1, 2], [2, 1])).toBe(false);
  expect(sameJson(null, {})).toBe(false);
});
