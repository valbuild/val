import fs from "fs";
import os from "os";
import path from "path";
import synchronizedPrettier from "@prettier/sync";
import type * as Prettier from "prettier";
import {
  createPrettierFormatter,
  type PrettierLike,
} from "./createPrettierFormatter";

/**
 * The shared formatter, against a real prettier.
 *
 * Nothing here mocks prettier, and that is the point: the bug this file exists
 * for was that `prettier.format(code, { filepath })` silently ignores
 * `.prettierrc`, which no fake would have reproduced. A `--fix` on a project
 * with `{ "singleQuote": true }` rewrote every string in the file it touched.
 *
 * It runs against `@prettier/sync` rather than `prettier` itself because
 * prettier 3's CommonJS entry loads its ESM build with a dynamic `import()`,
 * which jest refuses without `--experimental-vm-modules`. Every other suite in
 * this package reaches for the same shim for the same reason. The ASYNC library
 * is what ships, though, so it is asserted against {@link PrettierLike} at the
 * type level below — a structural description that drifts away from either one
 * stops this file compiling.
 */
type RealPrettierSatisfiesPrettierLike = typeof Prettier extends PrettierLike
  ? true
  : never;
const _realPrettierSatisfiesPrettierLike: RealPrettierSatisfiesPrettierLike = true;
void _realPrettierSatisfiesPrettierLike;

const prettierLike: PrettierLike = synchronizedPrettier;

const UNFORMATTED = `export const greeting = {message:"hello",  items:[1,2,3,]}\n`;

let projectRoot: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-prettier-"));
  fs.mkdirSync(path.join(projectRoot, "content"));
  // Prettier caches config per directory for the life of the process, and every
  // test here writes a different config into a different directory — but the
  // cache also remembers that a directory had NO config, which the "no config"
  // test would otherwise inherit from whoever ran before it.
  synchronizedPrettier.clearConfigCache();
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(projectRoot, ".prettierrc.json"),
    JSON.stringify(config),
  );
}

describe("createPrettierFormatter", () => {
  test("formats with the project's prettier config, not prettier's defaults", async () => {
    writeConfig({ singleQuote: true, trailingComma: "es5" });
    const format = createPrettierFormatter(prettierLike, { projectRoot });

    const formatted = await format(UNFORMATTED, "/content/page.val.ts");

    // The assertion that pins the bug: prettier's default is double quotes, so
    // a formatter that never read the config would produce `"hello"` here.
    expect(formatted).toContain("'hello'");
    expect(formatted).not.toContain('"hello"');
  });

  test("falls back to prettier's defaults when the project has no config", async () => {
    const format = createPrettierFormatter(prettierLike, { projectRoot });

    const formatted = await format(UNFORMATTED, "/content/page.val.ts");

    expect(formatted).toContain('"hello"');
    // Still formatted, just to prettier's own taste.
    expect(formatted).not.toEqual(UNFORMATTED);
  });

  test("leaves a file the project put in .prettierignore untouched", async () => {
    writeConfig({ singleQuote: true });
    fs.writeFileSync(
      path.join(projectRoot, ".prettierignore"),
      "content/generated.val.ts\n",
    );
    const format = createPrettierFormatter(prettierLike, { projectRoot });

    expect(await format(UNFORMATTED, "/content/generated.val.ts")).toBe(
      UNFORMATTED,
    );
    // The ignore entry is about that one file, not about the directory.
    expect(await format(UNFORMATTED, "/content/page.val.ts")).toContain(
      "'hello'",
    );
  });

  test("applies an `overrides` entry that matches the file", async () => {
    writeConfig({
      singleQuote: true,
      overrides: [{ files: "content/*.val.ts", options: { semi: false } }],
    });
    const format = createPrettierFormatter(prettierLike, { projectRoot });

    const formatted = await format(UNFORMATTED, "/content/page.val.ts");

    expect(formatted.trimEnd().endsWith("}")).toBe(true);
  });

  test("picks the parser from the extension, so a `*.val.json` entry is JSON", async () => {
    writeConfig({ singleQuote: true });
    const format = createPrettierFormatter(prettierLike, { projectRoot });

    const formatted = await format(
      `{"a":1,"b":[2,3]}`,
      "/content/page.val.json",
    );

    // JSON has no single-quoted strings: `singleQuote` must not reach it, which
    // is prettier's own doing and the reason the parser choice matters.
    expect(formatted).toContain('"a"');
    expect(formatted).toContain("\n");
  });

  test("accepts an absolute path inside the project as well as a project-relative one", async () => {
    writeConfig({ singleQuote: true });
    const format = createPrettierFormatter(prettierLike, { projectRoot });
    const absolute = path.join(projectRoot, "content", "page.val.ts");

    expect(await format(UNFORMATTED, absolute)).toEqual(
      await format(UNFORMATTED, "/content/page.val.ts"),
    );
  });

  test("resolves the config nearest the file, not only the one at the root", async () => {
    writeConfig({ singleQuote: false });
    const nested = path.join(projectRoot, "content");
    fs.writeFileSync(
      path.join(nested, ".prettierrc.json"),
      JSON.stringify({ singleQuote: true }),
    );
    const format = createPrettierFormatter(prettierLike, { projectRoot });

    expect(await format(UNFORMATTED, "/content/page.val.ts")).toContain(
      "'hello'",
    );
  });
});
