import { LinkedFileSystem } from "./linkedFileSystem";

const store = "/p/node_modules/.pnpm";
const react = `${store}/react@19.3.0/node_modules/react`;
const types = `${store}/@types+react@19.3.0/node_modules/@types/react`;
const csstype = `${store}/csstype@3.1.3/node_modules/csstype`;

function pnpmLike(): LinkedFileSystem {
  return new LinkedFileSystem(
    new Map([
      ["/p/node_modules/react", react],
      ["/p/node_modules/@types/react", types],
      [`${store}/@types+react@19.3.0/node_modules/csstype`, csstype],
      [`${store}/node_modules/csstype`, csstype],
      ["/p/packages/a/node_modules/b", "/p/packages/b"],
      ["/p/packages/b/node_modules/react", react],
    ]),
  );
}

describe("LinkedFileSystem", () => {
  test("reads a file through the links that lead to it", () => {
    const fs = pnpmLike();
    fs.writeFile(`${types}/index.d.ts`, "export {};");
    expect(fs.readFile("/p/node_modules/@types/react/index.d.ts")).toBe(
      "export {};",
    );
    expect(fs.realpath("/p/node_modules/@types/react/index.d.ts")).toBe(
      `${types}/index.d.ts`,
    );
    expect(fs.fileExists("/p/node_modules/react/index.d.ts")).toBe(false);
  });

  test("follows a link that is reached through another link", () => {
    const fs = pnpmLike();
    fs.writeFile(`${react}/package.json`, '{"name":"react"}');
    // a's `b` is the workspace project b, whose own `react` is a link again.
    expect(
      fs.realpath(
        "/p/packages/a/node_modules/b/node_modules/react/package.json",
      ),
    ).toBe(`${react}/package.json`);
    expect(
      fs.readFile(
        "/p/packages/a/node_modules/b/node_modules/react/package.json",
      ),
    ).toBe('{"name":"react"}');
  });

  test("knows every directory a file is in, and every linked directory, before anything is written into it", () => {
    const fs = pnpmLike();
    fs.writeFile(`${types}/ts5.0/jsx-runtime.d.ts`, "");
    expect(fs.directoryExists(`${types}/ts5.0`)).toBe(true);
    expect(fs.directoryExists("/p/node_modules/@types/react/ts5.0")).toBe(true);
    // Nothing has been written into react's directory, and it still exists,
    // as it does on disk.
    expect(fs.directoryExists("/p/node_modules/react")).toBe(true);
    expect(fs.directoryExists("/p/node_modules/vite")).toBe(false);
  });

  test("lists links among a directory's entries, so node_modules/@types can be listed", () => {
    const fs = pnpmLike();
    expect(fs.getDirectories("/p/node_modules/@types")).toEqual(["react"]);
    expect(fs.getDirectories("/p/node_modules")).toEqual([
      ".pnpm",
      "@types",
      "react",
    ]);
    fs.writeFile(`${react}/package.json`, "{}");
    expect(fs.getFiles("/p/node_modules/react")).toEqual(["package.json"]);
  });

  test("a workspace link points at the project's own directory", () => {
    const fs = pnpmLike();
    fs.writeFile("/p/packages/b/src/index.ts", "export const b = 1;");
    expect(fs.readFile("/p/packages/a/node_modules/b/src/index.ts")).toBe(
      "export const b = 1;",
    );
  });

  test("reports each lookup's real path", () => {
    const fs = pnpmLike();
    const looked: string[] = [];
    fs.onLookup = (real) => looked.push(real);
    fs.fileExists("/p/node_modules/react/package.json");
    expect(looked).toEqual([`${react}/package.json`]);
  });
});
