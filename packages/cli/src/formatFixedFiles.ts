import path from "path";
import fs from "fs/promises";
import { createPrettierFormatter, type PrettierLike } from "@valbuild/server";

/** A file whose fix landed but which could not be formatted afterwards. */
export type FormatFailure = {
  /** Project-relative, as `--fix` reported it. */
  file: string;
  message: string;
};

export type FormatFixedFilesResult = {
  /** Files actually rewritten — a file already in its final form is not. */
  written: string[];
  failures: FormatFailure[];
};

/**
 * Format the files `--fix` just wrote, the way the project formats everything.
 *
 * Through `createPrettierFormatter`, which is the same function an app hands to
 * `initValServer` / `initValMcp`, so a fix applied here and an edit saved from
 * the Studio come out identically formatted. Calling
 * `prettier.format(code, { filepath })` directly — which this did — reads no
 * config at all: `filepath` picks the parser, and `.prettierrc` is only ever
 * consulted by `resolveConfig`, `getFileInfo` and prettier's own CLI. A project
 * whose style is not prettier's default got its whole file rewritten by a
 * two-line content fix, and a red `format` job with it.
 *
 * Separate from `validate.ts` so it can be tested against a real project on
 * disk: `runValidation` stops before this step, and `validate()` itself ends in
 * `process.exit`, so neither can reach it from a test.
 *
 * Rendering is the caller's, which is why failures are returned rather than
 * logged. A file that cannot be formatted is not a failed run: the fix itself
 * landed, and stopping here would leave the fix applied and the report unwritten.
 */
export async function formatFixedFiles(
  prettier: PrettierLike,
  projectRoot: string,
  files: Iterable<string>,
): Promise<FormatFixedFilesResult> {
  const format = createPrettierFormatter(prettier, { projectRoot });
  const written: string[] = [];
  const failures: FormatFailure[] = [];
  for (const file of files) {
    const filePath = path.join(projectRoot, file);
    const fileContent = await fs.readFile(filePath, "utf-8");
    let formattedContent: string;
    try {
      formattedContent = await format(fileContent, file);
    } catch (err) {
      failures.push({
        file,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    // A file prettier left alone — one the project put in `.prettierignore`,
    // or one already in its final form — is not rewritten. Writing identical
    // bytes still bumps the mtime, and a `--fix` run alongside a dev server
    // makes it rebuild for nothing.
    if (formattedContent !== fileContent) {
      await fs.writeFile(filePath, formattedContent);
      written.push(file);
    }
  }
  return { written, failures };
}
