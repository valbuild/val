/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_SOURCE_MODULE,
  readProjectSource,
  valProjectSource,
} from "./index";

/** A project on disk: Val's files, and everything a project has besides. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "val-project-source-"));
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("val.config.ts", "export const config = {};\n");
  write("val.modules.ts", "export default [];\n");
  write("src/routes/_site.index.val.ts", 'export default "page";\n');
  write("content/authors/ada.val.json", '{"name":"Ada"}\n');
  write("src/routes/_site.index.tsx", "export const Route = 1;\n");
  write("package.json", "{}\n");
  write("node_modules/pkg/thing.val.ts", "nope\n");
  write("dist/server/copy.val.ts", "nope\n");
  write(".git/HEAD", "ref: refs/heads/main\n");
  return root;
}

const RESOLVED = `\0${PROJECT_SOURCE_MODULE}`;

describe("valProjectSource", () => {
  test("embeds Val's source and nothing else, by posix path from the project root", () => {
    const root = project();
    expect(readProjectSource(root)).toEqual({
      "val.config.ts": "export const config = {};\n",
      "val.modules.ts": "export default [];\n",
      "src/routes/_site.index.val.ts": 'export default "page";\n',
      "content/authors/ada.val.json": '{"name":"Ada"}\n',
    });
  });

  test("serves it to the server as virtual:val/project-source, from Vite's root, watching every file", () => {
    const root = project();
    const plugin = valProjectSource();
    plugin.configResolved({ root });
    expect(plugin.resolveId(PROJECT_SOURCE_MODULE)).toBe(RESOLVED);
    expect(plugin.resolveId("./something-else")).toBeUndefined();

    const watched: string[] = [];
    const code = plugin.load.call(
      {
        addWatchFile: (file: string) => watched.push(file),
        environment: { config: { consumer: "server" } },
      },
      RESOLVED,
    );
    const files: unknown = JSON.parse(
      String(code)
        .replace(/^export const FILES = /, "")
        .split(";\n")[0]!,
    );
    expect(files).toEqual(readProjectSource(root));
    expect(watched.sort()).toEqual(
      Object.keys(readProjectSource(root))
        .map((path) => join(root, path))
        .sort(),
    );
    expect(plugin.load.call({}, "/some/other/module.ts")).toBeUndefined();
  });

  test("refuses the browser: the project's source must not reach every visitor", () => {
    const plugin = valProjectSource({ root: project() });
    // Vite 6 on: the environment says who is asking.
    expect(() =>
      plugin.load.call(
        { environment: { config: { consumer: "client" } } },
        RESOLVED,
      ),
    ).toThrow(/server-only/);
    // Before it: the ssr flag.
    expect(() => plugin.load.call({}, RESOLVED, { ssr: false })).toThrow(
      /server-only/,
    );
    expect(plugin.load.call({}, RESOLVED, { ssr: true })).toMatch(
      /^export const FILES = /,
    );
  });
});
