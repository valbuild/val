import * as fs from "node:fs";
import * as path from "node:path";
import {
  packageDirOf,
  packageNameOf,
  SourceError,
  typesPackageOf,
  type TypecheckSources,
} from "./acquireTypes";
import {
  newErrors,
  typecheckProject,
  type TypeErrorEntry,
} from "./typecheckProject";
import { BUNDLED_TYPESCRIPT, chooseCompiler } from "./typescriptCompiler";
import { nodeModulesSources } from "./testing/nodeModulesSources";

/*
 * A small project on template-tanstack-minimal's real lockfile (the layout
 * fixture), whose bundles are cut from this repository's own installed
 * packages. The versions differ from the lockfile's (`anyVersion`): these
 * tests are about which packages are fetched and where they land. Parity
 * with `tsc` on the real templates, with adept's own bundles, is
 * `testing/typecheckParity.ts`.
 */
const REPO = path.resolve(__dirname, "../../../..");
const lockfile = fs.readFileSync(
  path.join(__dirname, "fixtures/template-tanstack-minimal/pnpm-lock.yaml"),
  "utf8",
);

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022", "DOM"],
    jsx: "react-jsx",
    module: "ESNext",
    moduleResolution: "bundler",
    types: ["node"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["src"],
});

const app = `import { useState } from "react";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { greeting } from "./greeting";

const Settings = z.object({ name: z.string() });

export function App() {
  const [count] = useState(0);
  const settings = Settings.parse(JSON.parse(readFileSync("s.json", "utf8")));
  return <p>{greeting(settings.name)} {count}</p>;
}
`;

const files = (overrides: Record<string, string> = {}) => ({
  "package.json": '{ "name": "small", "private": true }',
  "tsconfig.json": tsconfig,
  "src/app.tsx": app,
  "src/greeting.ts":
    "export const greeting = (name: string): string => `Hello, ${name}`;\n",
  // Not in the tsconfig: what it imports is not wanted.
  "eslint.config.mjs": 'import js from "@eslint/js";\nexport default [js];\n',
  ...overrides,
});

function counted(sources: TypecheckSources) {
  const asked: string[] = [];
  return {
    asked,
    sources: {
      types: (pkg) => {
        asked.push(pkg.name);
        return sources.types(pkg);
      },
      compiler: (version) => sources.compiler(version),
    } satisfies TypecheckSources,
  };
}

const repoSources = () => nodeModulesSources(REPO, { anyVersion: true });

describe("typecheckProject", () => {
  test("fetches the types the imports reach, and only those", async () => {
    const { asked, sources } = counted(repoSources());
    const result = await typecheckProject({
      files: files(),
      lockfile,
      sources,
      listFiles: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.typescript).toEqual({
      version: "6.0.3",
      wanted: "6.0.3",
      reason: "project",
    });
    // react has no types of its own, so @types/react beside it is fetched
    // too; csstype is what @types/react imports, undici-types what
    // @types/node does. @types/node also re-exports `punycode` and
    // `string_decoder` by bare name, and this lockfile hoists npm packages of
    // those names, whose package.json `tsc` reads on disk too (its
    // `--traceResolution` says so). Nothing else of the 357 packages.
    expect([...asked].sort()).toEqual([
      "@types/node",
      "@types/react",
      "csstype",
      "punycode",
      "react",
      "string_decoder",
      "undici-types",
      "zod",
    ]);
    // Every bundle is at its snapshot's directory, and the program reaches
    // it through the links.
    const fileNames = result.programs[0]!.fileNames!;
    expect(fileNames).toContain(
      "node_modules/.pnpm/@types+react@19.3.0/node_modules/@types/react/index.d.ts",
    );
    expect(
      fileNames.some((name) =>
        name.startsWith("node_modules/.pnpm/zod@4.6.5/node_modules/zod/"),
      ),
    ).toBe(true);
    expect(result.programs).toHaveLength(1);
    expect(result.programs[0]!.tsconfig).toBe("tsconfig.json");
  });

  test("reports exactly the errors planted, in project terms", async () => {
    const result = await typecheckProject({
      files: files({
        "src/app.tsx": app
          .replace(
            "const [count] = useState(0);",
            'const [count] = useState(0);\n  const n: number = "one";\n  console.log(n);',
          )
          .replace("z.string()", "z.string().min('3')")
          .replace("greeting(settings.name)", "greeting(settings.name, 2)"),
      }),
      lockfile,
      sources: repoSources(),
    });
    expect(
      result.errors.map(({ file, line, code }) => ({ file, line, code })),
    ).toEqual([
      { file: "src/app.tsx", line: 6, code: 2345 },
      { file: "src/app.tsx", line: 10, code: 2322 },
      { file: "src/app.tsx", line: 13, code: 2554 },
    ]);
    expect(result.errors[1]!.message).toBe(
      "Type 'string' is not assignable to type 'number'.",
    );
  });

  test("an untyped package still resolves, to its JavaScript, as in a real install", async () => {
    // Without @types/react, `react` is its package.json and stubs: TypeScript
    // finds the module and says it has no declaration (7016), rather than
    // that there is no such module (2307).
    const base = repoSources();
    const result = await typecheckProject({
      files: files(),
      lockfile,
      sources: {
        types: (pkg) =>
          pkg.name === "@types/react"
            ? Promise.reject(
                new SourceError(
                  "Not today.",
                  "registry-unreachable",
                  true,
                  502,
                ),
              )
            : base.types(pkg),
        compiler: (version) => base.compiler(version),
      },
    });
    expect(result.errors.map((e) => e.code)).toContain(7016);
    expect(result.errors.map((e) => e.code)).not.toContain(2307);
    expect(result.missing).toEqual([
      expect.objectContaining({
        name: "@types/react",
        code: "registry-unreachable",
        retryable: true,
      }),
    ]);
  });

  test("being signed out stops the check rather than reporting every package missing", async () => {
    const base = repoSources();
    await expect(
      typecheckProject({
        files: files(),
        lockfile,
        sources: {
          types: () =>
            Promise.reject(new SourceError("Sign in.", "401", false, 401)),
          compiler: (version) => base.compiler(version),
        },
      }),
    ).rejects.toThrow("Sign in.");
  });

  test("TypeScript 7 is checked with the bundled 6.x", async () => {
    const base = repoSources();
    const asked: string[] = [];
    const result = await typecheckProject({
      files: files(),
      lockfile: lockfile.replace(
        /(\n {6}typescript:\n {8}specifier: [^\n]+\n {8}version: )6\.0\.3/,
        "$17.0.2",
      ),
      sources: {
        types: (pkg) => base.types(pkg),
        compiler: (version) => {
          asked.push(version);
          return base.compiler(version);
        },
      },
    });
    expect(asked).toEqual([BUNDLED_TYPESCRIPT]);
    expect(result.typescript).toEqual({
      version: BUNDLED_TYPESCRIPT,
      wanted: "7.0.2",
      reason: "no-js-compiler",
    });
    expect(result.errors).toEqual([]);
  });
});

describe("chooseCompiler", () => {
  test("the project's own, unless it has none that runs here", () => {
    expect(chooseCompiler("5.9.3").version).toBe("5.9.3");
    expect(chooseCompiler("7.0.2")).toEqual({
      version: BUNDLED_TYPESCRIPT,
      wanted: "7.0.2",
      reason: "no-js-compiler",
    });
    expect(chooseCompiler(null).reason).toBe("no-typescript");
  });

  test("the bundled 6.x is the one the Studio is built with", () => {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(require.resolve("typescript/package.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ version: BUNDLED_TYPESCRIPT });
  });
});

describe("specifiers", () => {
  test.each([
    ["react", "react"],
    ["react/jsx-runtime", "react"],
    ["@tanstack/react-router", "@tanstack/react-router"],
    ["@tanstack/react-start/server", "@tanstack/react-start"],
    ["./local", null],
    ["/absolute", null],
    ["#/components", null],
    ["node:fs", null],
    ["@/components", null],
  ])("%s names %s", (specifier, name) => {
    expect(packageNameOf(specifier)).toBe(name);
  });

  test("the @types twin of a package", () => {
    expect(typesPackageOf("node")).toBe("@types/node");
    expect(typesPackageOf("@babel/core")).toBe("@types/babel__core");
  });

  test("the package a real path is in", () => {
    expect(
      packageDirOf(
        "/p/node_modules/.pnpm/@types+react@19.3.0/node_modules/@types/react/ts5.0/index.d.ts",
      ),
    ).toBe(
      "/p/node_modules/.pnpm/@types+react@19.3.0/node_modules/@types/react",
    );
    expect(packageDirOf("/p/node_modules/.pnpm/node_modules")).toBeNull();
    expect(packageDirOf("/p/src/app.tsx")).toBeNull();
  });
});

describe("newErrors", () => {
  const error = (
    file: string,
    line: number,
    message: string,
  ): TypeErrorEntry => ({
    file,
    line,
    column: 1,
    code: 2322,
    message,
    tsconfig: "tsconfig.json",
  });

  test("counts only what the base does not already have", () => {
    const base = [error("a.ts", 1, "old"), error("b.ts", 4, "old")];
    const next = [
      error("a.ts", 3, "old"),
      error("b.ts", 4, "old"),
      error("b.ts", 9, "new"),
    ];
    // a.ts's error moved two lines down: it is the same error.
    expect(newErrors(base, next)).toEqual([error("b.ts", 9, "new")]);
  });

  test("a second copy of an error the base has once is new", () => {
    expect(
      newErrors(
        [error("a.ts", 1, "x")],
        [error("a.ts", 1, "x"), error("a.ts", 2, "x")],
      ),
    ).toEqual([error("a.ts", 2, "x")]);
  });

  test("fixing errors is not an error", () => {
    expect(newErrors([error("a.ts", 1, "x")], [])).toEqual([]);
  });
});
