import { parse } from "./ast";
import { loadRolldown, useRolldown, type Rolldown } from "./rolldown";

/**
 * Node hands the build native rolldown, and the build must then never reach
 * for `@rolldown/browser`: loading its WebAssembly in Node is what broke
 * `val publish` when a site's lockfile took `@napi-rs/wasm-runtime` 1.2.6
 * (architecture/quirks.md, 2026-10-26). jest cannot load either real
 * build here (both are ESM-only), so a stand-in is handed over and every
 * call is expected to land on it.
 */
test("a bundler handed over is the one the build parses and bundles with", async () => {
  const parsed: string[] = [];
  const handed: Rolldown = {
    build: async () => {
      throw new Error("not called here");
    },
    parseAstAsync: async (code) => {
      parsed.push(code);
      return {
        type: "Program",
        start: 0,
        end: code.length,
        body: [],
        sourceType: "module",
        hashbang: null,
      };
    },
  };
  useRolldown(handed);

  expect(await loadRolldown()).toBe(handed);
  const ast = await parse("src/app.tsx", "export {};");
  expect(ast.type).toBe("Program");
  expect(parsed).toEqual(["export {};"]);
});
