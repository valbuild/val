import { toReviewCode } from "./toReviewCode";

const site = {
  "src/Button.tsx": "export const Button = 1;\n",
  "src/old.ts": "export const old = true;\n",
  "content/page.val.ts": "export default 1;\n",
};

test("lists what was staged as code, with what each file changed", () => {
  const code = toReviewCode(
    site,
    {
      "src/Button.tsx": "export const Button = 2;\n",
      "src/new.ts": "export const fresh = true;\n",
      "src/old.ts": null,
    },
    ["src/Button.tsx", "src/new.ts", "src/old.ts"],
  );
  expect(
    code?.groups[0].files.map((file) => [
      file.path,
      file.change,
      file.added,
      file.removed,
    ]),
  ).toEqual([
    ["src/Button.tsx", "modified", 1, 1],
    ["src/new.ts", "added", 1, 0],
    ["src/old.ts", "deleted", 0, 1],
  ]);
});

/** A content save rewrites the file; what it changed is shown as content. */
test("leaves out a file a content save wrote", () => {
  const code = toReviewCode(
    site,
    {
      "content/page.val.ts": "export default 2;\n",
      "src/Button.tsx": "export const Button = 2;\n",
    },
    ["src/Button.tsx"],
  );
  expect(code?.groups[0].files.map((file) => file.path)).toEqual([
    "src/Button.tsx",
  ]);
});

test("is nothing when no code changed", () => {
  expect(
    toReviewCode(site, { "content/page.val.ts": "export default 2;\n" }, []),
  ).toBeUndefined();
  // Staged with the site's own text again: no change.
  expect(
    toReviewCode(site, { "src/Button.tsx": site["src/Button.tsx"] }, [
      "src/Button.tsx",
    ]),
  ).toBeUndefined();
});

/** Which chat staged a file is not recorded, so none is claimed. */
test("names no chat", () => {
  const code = toReviewCode(site, { "src/new.ts": "1\n" }, ["src/new.ts"]);
  expect(code?.groups).toHaveLength(1);
  expect(code?.groups[0].session).toBeNull();
});
