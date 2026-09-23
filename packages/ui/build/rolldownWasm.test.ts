import fs from "fs";
import path from "path";
import { DEFAULT_STATIC_HOST as CORE_STATIC_HOST } from "@valbuild/core";
import {
  DEFAULT_STATIC_HOST,
  WASM_FILENAME,
  findRolldownWasm,
  sha256Of,
  wasmAssetsIn,
  wasmUrl,
  wasmUrlExpression,
  RUNTIME_OVERRIDE_GLOBAL,
} from "./rolldownWasm";

/**
 * The build-side half of keeping rolldown's 10.9 MB binary out of the package.
 *
 * Nothing here loads `@rolldown/browser` -- it is ESM-only and WASI-backed, and
 * this repository's jest is CommonJS. What is checked is the addressing and the
 * two places the same string has to be written twice.
 */

describe("the static host", () => {
  test("is the one @valbuild/core declares", () => {
    /*
     * Two literals, because Vite loads a config file by bundling it to ESM and
     * core's built entry is CommonJS -- importing the constant there fails at
     * config load with "Named export not found". This is what keeps the copy
     * honest, and it is the only thing that does.
     */
    expect(DEFAULT_STATIC_HOST).toBe(CORE_STATIC_HOST);
  });
});

describe("the runtime override", () => {
  test("wins over the baked URL, and the baked URL is the fallback", () => {
    const expression = wasmUrlExpression("https://example.test/x.wasm");
    expect(expression).toBe(
      `(globalThis.${RUNTIME_OVERRIDE_GLOBAL} ?? "https://example.test/x.wasm")`,
    );
    // Evaluated rather than only string-matched: this is printed INTO the
    // bundle, so a form that does not parse is a broken build.
    const evaluate = (scope: Record<string, unknown>): unknown =>
      new Function("globalThis", `return ${expression}`)(scope);
    expect(evaluate({})).toBe("https://example.test/x.wasm");
    expect(
      evaluate({ [RUNTIME_OVERRIDE_GLOBAL]: "https://mirror.test/y.wasm" }),
    ).toBe("https://mirror.test/y.wasm");
  });
});

describe("addressing", () => {
  test("puts the digest in the path", () => {
    expect(wasmUrl("https://static.val.build", "abc123")).toBe(
      `https://static.val.build/rolldown/abc123/${WASM_FILENAME}`,
    );
  });

  test("a trailing slash on the host does not double up", () => {
    expect(wasmUrl("https://static.val.build/", "abc123")).toBe(
      `https://static.val.build/rolldown/abc123/${WASM_FILENAME}`,
    );
  });
});

describe("what must not be embedded", () => {
  test("is every .wasm, not the one filename", () => {
    // Named by content hash in the output, and a rolldown that shipped a second
    // binary would slip past a check on the exact name.
    expect(
      wasmAssetsIn([
        "index-abc.js",
        "rolldown-binding.wasm32-wasi-BIbwWG4g.wasm",
        "something-else-Xy.wasm",
        "index-abc.css",
      ]),
    ).toEqual([
      "rolldown-binding.wasm32-wasi-BIbwWG4g.wasm",
      "something-else-Xy.wasm",
    ]);
  });
});

describe("finding the binary", () => {
  /*
   * Resolved THROUGH `@valbuild/tanstack-build`, which is the package that
   * declares the dependency. From here it would find whatever a hoist happened
   * to put in reach -- the version skew the content addressing exists to make
   * impossible would then start at the wrong file.
   */
  const file = findRolldownWasm(path.join(__dirname, ".."));

  test("resolves through the package that declares it", () => {
    expect(file).toContain(path.join("@rolldown", "browser", "dist"));
    expect(path.basename(file)).toBe(WASM_FILENAME);
  });

  test("hashes to 64 hex characters of the real bytes", () => {
    const digest = sha256Of(file);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // The binary is what it says it is: wasm's magic number, so a truncated or
    // text-decoded copy fails here rather than at a user's first publish.
    expect([...fs.readFileSync(file).subarray(0, 4)]).toEqual([
      0x00, 0x61, 0x73, 0x6d,
    ]);
  });
});
