import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import path from "path";
import fs from "fs";
import { validateOnce } from "./validate";

/**
 * A local file in a project with remote files is a WARNING: `val validate`
 * prints it and passes, `--strict` makes it fail. Every project made from a
 * template starts this way, hosted ones included, and the site serves those
 * files from public/ until they are uploaded.
 */

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD//" +
    "/+l2Z/dAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB9oIBRELLnJqTAAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==",
  "base64",
);

const IMAGES = Array.from(
  { length: 7 },
  (_, i) => `/public/val/images/image-${i}_0000${i}.png`,
);

const PROJECT: Record<string, string | Buffer> = {
  "val.modules.ts": `import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/images.val") },
]);
`,
  "content/images.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/images.val.ts",
  s.imagedir("/public/val/images").remote(),
  {
${IMAGES.map(
  (image) =>
    `    "${image}": { width: 8, height: 8, mimeType: "image/png", alt: null },`,
).join("\n")}
  },
);
`,
  ...Object.fromEntries(IMAGES.map((image) => [image.slice(1), PNG])),
};

describe("val validate: a local file in a project with remote files", () => {
  let root: string;
  let output: string[];
  let log: jest.SpyInstance;

  beforeEach(() => {
    const tmpBase = path.join(__dirname, "..", ".tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    root = fs.mkdtempSync(path.join(tmpBase, "warnings-"));
    for (const file of ["val.config.ts", "tsconfig.json"]) {
      fs.copyFileSync(path.join(BASIC_FIXTURE, file), path.join(root, file));
    }
    for (const [file, content] of Object.entries(PROJECT)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    output = [];
    log = jest.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
  });

  afterEach(() => {
    log.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // eslint-disable-next-line no-control-regex
  const plain = () => output.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

  test("is printed once, over every file it is about, and passes", async () => {
    expect(await validateOnce({ projectRoot: root, fix: false })).toBe(0);
    const text = plain();
    expect(text).toContain("content/images.val.ts  ⚠ 7 warnings");
    expect(
      text.match(/Local files in a project with remote files/g),
    ).toHaveLength(1);
    expect(text).toContain(IMAGES[0]);
    expect(text).toContain("… 2 more");
    expect(text).toContain("→ val validate --fix uploads them");
    expect(text).toContain("✔ No validation errors · 7 warnings in 1 file");
  });

  test("fails under --strict", async () => {
    expect(
      await validateOnce({ projectRoot: root, fix: false, strict: true }),
    ).toBe(7);
    expect(plain()).toContain(
      "✘ No validation errors · 7 warnings in 1 file, which --strict counts as errors",
    );
  });

  test("does not hold back val publish, unless --strict", async () => {
    expect(
      await validateOnce({ projectRoot: root, fix: false, blockingOnly: true }),
    ).toBe(0);
    expect(
      await validateOnce({
        projectRoot: root,
        fix: false,
        blockingOnly: true,
        strict: true,
      }),
    ).toBe(7);
  });

  test("fails under --fix when the files cannot be uploaded", async () => {
    // Not logged in: there is no .val/pat.json in the project.
    expect(
      await validateOnce({ projectRoot: root, fix: true }),
    ).toBeGreaterThan(0);
    const text = plain();
    expect(text).toContain("not logged in");
    expect(text).not.toContain("⚠");
  });
});
