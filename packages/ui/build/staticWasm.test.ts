import fs from "fs";
import path from "path";
import { DEFAULT_STATIC_HOST as CORE_STATIC_HOST } from "@valbuild/core";
import {
  DEFAULT_STATIC_HOST,
  ROLLDOWN_WASM,
  STATIC_WASM,
  WEBP_SIMD_WASM,
  WEBP_WASM,
  binariesNamedBy,
  filenameOf,
  findRolldownWasm,
  locateWasm,
  sha256Of,
  wasmAssetsIn,
  wasmUrl,
  wasmUrlExpression,
} from "./staticWasm";

/**
 * The build-side half of keeping the Studio's WebAssembly out of the package.
 *
 * Nothing here loads a binary -- `@rolldown/browser` is ESM-only and
 * WASI-backed, and this repository's jest is CommonJS. What is checked is the
 * addressing, the list, and the two places the same string has to be written
 * twice.
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
    const expression = wasmUrlExpression(
      ROLLDOWN_WASM,
      "https://example.test/x.wasm",
    );
    expect(expression).toBe(
      `(globalThis.__VAL_ROLLDOWN_WASM_URL__ ?? "https://example.test/x.wasm")`,
    );
    // Evaluated rather than only string-matched: this is printed INTO the
    // bundle, so a form that does not parse is a broken build.
    const evaluate = (scope: Record<string, unknown>): unknown =>
      new Function("globalThis", `return ${expression}`)(scope);
    expect(evaluate({})).toBe("https://example.test/x.wasm");
    expect(
      evaluate({ __VAL_ROLLDOWN_WASM_URL__: "https://mirror.test/y.wasm" }),
    ).toBe("https://mirror.test/y.wasm");
  });

  test("is one global per binary", () => {
    // Two binaries behind one global would send a mirror's rolldown URL to the
    // WebP encoder, and the other way round.
    const globals = STATIC_WASM.map((wasm) => wasm.overrideGlobal);
    expect(new Set(globals).size).toBe(globals.length);
  });

  test("keeps rolldown's name, which the builder worker is handed by name", () => {
    // `builderWorkerClient.ts` forwards this exact global into the worker, and
    // deployments already set it. Renaming it is a breaking change.
    expect(ROLLDOWN_WASM.overrideGlobal).toBe("__VAL_ROLLDOWN_WASM_URL__");
  });
});

describe("addressing", () => {
  test("puts the name and the digest in the path", () => {
    expect(
      wasmUrl("https://content.val.build/v1/static", ROLLDOWN_WASM, "abc123"),
    ).toBe(
      `https://content.val.build/v1/static/rolldown/abc123/rolldown-binding.wasm32-wasi.wasm`,
    );
    expect(
      wasmUrl("https://content.val.build/v1/static", WEBP_SIMD_WASM, "def456"),
    ).toBe(
      `https://content.val.build/v1/static/webp/def456/webp_enc_simd.wasm`,
    );
  });

  test("a trailing slash on the host does not double up", () => {
    expect(
      wasmUrl("https://content.val.build/v1/static/", ROLLDOWN_WASM, "abc123"),
    ).toBe(
      `https://content.val.build/v1/static/rolldown/abc123/rolldown-binding.wasm32-wasi.wasm`,
    );
  });

  test("no two binaries can be served at the same URL", () => {
    const addresses = STATIC_WASM.map(
      (wasm) => `${wasm.name}/${filenameOf(wasm)}`,
    );
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});

describe("what must not be embedded", () => {
  test("is every .wasm, not the names on the list", () => {
    // The emitted name carries a content hash, so a check on the literal
    // filenames would miss the rename -- or the new binary -- this exists to
    // notice. `closeBundle` refuses a .wasm that is not on the list.
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

describe("which binary an emitted asset is", () => {
  test("is read off the name Vite gave it", () => {
    expect(
      binariesNamedBy(
        "assets/rolldown-binding.wasm32-wasi-BIbwWG4g.wasm",
        STATIC_WASM,
      ),
    ).toEqual([ROLLDOWN_WASM]);
    expect(binariesNamedBy("webp_enc-a1B2_c3-.wasm", STATIC_WASM)).toEqual([
      WEBP_WASM,
    ]);
    expect(binariesNamedBy("webp_enc_simd-a1B2c3D4.wasm", STATIC_WASM)).toEqual(
      [WEBP_SIMD_WASM],
    );
  });

  test("a name that is a prefix of another does not claim it", () => {
    // `webp_enc` is a prefix of `webp_enc_simd`, and a hash may contain `-` and
    // `_`. The fixed hash length is what tells them apart.
    for (const wasm of STATIC_WASM) {
      const stem = filenameOf(wasm).replace(/\.wasm$/, "");
      expect(binariesNamedBy(`${stem}-AAAAAAAA.wasm`, STATIC_WASM)).toEqual([
        wasm,
      ]);
    }
  });

  test("is nothing for a binary that is not on the list", () => {
    expect(
      binariesNamedBy("something-else-Xy123456.wasm", STATIC_WASM),
    ).toEqual([]);
    // Not an emitted name at all: Vite always appends a hash.
    expect(binariesNamedBy("webp_enc.wasm", STATIC_WASM)).toEqual([]);
  });
});

describe("finding the binaries", () => {
  const root = path.join(__dirname, "..");

  test("rolldown resolves through the package that declares it", () => {
    /*
     * Resolved THROUGH `@valbuild/tanstack-build`, which is the package that
     * declares the dependency. From here it would find whatever a hoist
     * happened to put in reach -- the version skew the content addressing
     * exists to make impossible would then start at the wrong file.
     */
    const file = findRolldownWasm(root);
    expect(file).toContain(path.join("@rolldown", "browser", "dist"));
    expect(path.basename(file)).toBe(filenameOf(ROLLDOWN_WASM));
  });

  test.each(STATIC_WASM.map((wasm) => [filenameOf(wasm), wasm] as const))(
    "%s is installed, and is WebAssembly",
    (_, wasm) => {
      const file = locateWasm(root, wasm);
      expect(sha256Of(file)).toMatch(/^[0-9a-f]{64}$/);
      // wasm's magic number, so a truncated or text-decoded copy fails here
      // rather than in an editor's browser.
      expect([...fs.readFileSync(file).subarray(0, 4)]).toEqual([
        0x00, 0x61, 0x73, 0x6d,
      ]);
    },
  );
});
