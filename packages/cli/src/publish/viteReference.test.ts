import {
  compareWithVite,
  unrunPlugins,
  type ViteReference,
} from "./viteReference";

type Built = Extract<ViteReference, { status: "built" }>;
const reference = (
  imports: Built["imports"],
  plugins: string[] = [],
): Built => ({ status: "built", imports, plugins });

test("an import Vite resolves and Val leaves for the runtime is a difference", () => {
  const differences = compareWithVite(
    reference([
      {
        importer: "src/routes/__root.tsx",
        specifier: "@fontsource/inter",
        resolved: "node_modules/@fontsource/inter/index.css",
      },
    ]),
    {
      unresolvedImports: [
        { importer: "src/routes/__root.tsx", specifier: "@fontsource/inter" },
      ],
      stylesheets: [],
    },
  );
  expect(differences).toHaveLength(1);
  expect(differences[0]!.message).toContain(
    `import "@fontsource/inter/index.css"`,
  );
});

test("an import neither build resolves is not Vite's to judge", () => {
  expect(
    compareWithVite(
      reference([
        { importer: "src/a.ts", specifier: "node:fs", resolved: null },
      ]),
      {
        unresolvedImports: [{ importer: "src/a.ts", specifier: "node:fs" }],
        stylesheets: [],
      },
    ),
  ).toEqual([]);
});

test("a stylesheet Vite puts on the page and Val's CSS lacks is a difference", () => {
  // `import("../lazy.css")`: Val resolves it -- to nothing -- so it is not
  // unresolved, and only the stylesheet list shows it is missing.
  const differences = compareWithVite(
    reference([
      {
        importer: "src/routes/index.tsx",
        specifier: "../lazy.css",
        resolved: "src/lazy.css",
      },
      {
        importer: "src/routes/__root.tsx",
        specifier: "../styles.css",
        resolved: "src/styles.css",
      },
    ]),
    { unresolvedImports: [], stylesheets: ["src/styles.css"] },
  );
  expect(differences.map((d) => d.specifier)).toEqual(["../lazy.css"]);
  expect(differences[0]!.message).toContain("import it statically");
});

test("a dependency's stylesheet is matched by its specifier, and ?url by its file", () => {
  expect(
    compareWithVite(
      reference([
        {
          importer: "src/routes/__root.tsx",
          specifier: "@fontsource/inter/700.css",
          resolved:
            "node_modules/.pnpm/x/node_modules/@fontsource/inter/700.css",
        },
        {
          importer: "src/routes/__root.tsx",
          specifier: "../styles.css?url",
          resolved: "src/styles.css?url",
        },
        {
          importer: "src/a.tsx",
          specifier: "./b.css?inline",
          resolved: "src/b.css?inline",
        },
      ]),
      {
        unresolvedImports: [],
        stylesheets: ["@fontsource/inter/700.css", "src/styles.css"],
      },
    ),
  ).toEqual([]);
});

test("a Sass stylesheet says to convert it, and a virtual module names the plugin gap", () => {
  const differences = compareWithVite(
    reference([
      {
        importer: "src/a.tsx",
        specifier: "./x.scss",
        resolved: "src/x.scss",
      },
      {
        importer: "src/a.tsx",
        specifier: "virtual:uno.css",
        resolved: "\0virtual:uno.css",
      },
    ]),
    {
      unresolvedImports: [
        { importer: "src/a.tsx", specifier: "virtual:uno.css" },
      ],
      stylesheets: [],
    },
  );
  expect(differences.map((d) => d.specifier).sort()).toEqual([
    "./x.scss",
    "virtual:uno.css",
  ]);
  expect(
    differences.find((d) => d.specifier === "./x.scss")!.message,
  ).toContain("convert the stylesheet to CSS");
  const virtual = differences.find((d) => d.specifier === "virtual:uno.css")!;
  expect(virtual.message).toContain("runs no Vite plugins");
  expect(virtual.message).not.toContain("\0");
});

test("only the plugins Val does not do the work of are named", () => {
  expect(
    unrunPlugins(
      reference(
        [],
        [
          "vite:css",
          "tanstack-start-core:config",
          "@tailwindcss/vite:generate:build",
          "vite:react-babel",
          "unocss:global",
          "unocss:global",
          "vite-plugin-svgr",
        ],
      ),
    ),
  ).toEqual(["unocss:global", "vite-plugin-svgr"]);
});
