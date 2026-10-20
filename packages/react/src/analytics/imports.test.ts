import fs from "node:fs";
import path from "node:path";

/**
 * `@valbuild/react/analytics` is downloaded by every visitor of a site with
 * analytics on, so it may import nothing but its own files: no
 * `@valbuild/core` (one 400 KB module), no `@valbuild/shared` (zod), nothing
 * from npm. See `docs/plans/client-bundle-weight.md`.
 */
test("the analytics entrypoint imports only its own files", () => {
  const dir = __dirname;
  const sources = fs
    .readdirSync(dir)
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  expect(sources).toContain("index.ts");
  const offending: string[] = [];
  for (const file of sources) {
    const text = fs.readFileSync(path.join(dir, file), "utf-8");
    const specifiers = [
      ...text.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (!specifier.startsWith("./")) {
        offending.push(`${file}: ${specifier}`);
      }
    }
  }
  expect(offending).toEqual([]);
});
