/**
 * Formatting a proposal's files the way the project does, in the tab: the
 * assistant's `format_files` (valbuild/home `docs/design-tab.md`).
 *
 * In the tab rather than on the site's Val server because on the platform the
 * server has no formatter to run: Prettier's bundle crashes in a Worker isolate,
 * so the platform wires none (`@valbuild/tanstack-build`'s `wire.ts`). The tab
 * runs Prettier's standalone build, loaded the first time a file is formatted --
 * like the typecheck, it costs nothing to a Studio that never asks.
 *
 * What it knows of the project is its JSON config: `.prettierrc`,
 * `.prettierrc.json` or `package.json`'s `prettier`, the nearest one above the
 * file, as Prettier looks for them. A config it cannot read here -- JavaScript,
 * YAML, TOML, a shared config named by package, or plugins -- is said, not
 * guessed at: formatting with defaults would rewrite the project's style.
 *
 * The Prettier is the Studio's own (the version this repository pins), not the
 * project's: the two can differ in the odd corner a release changes.
 */

export type FormatOutcome =
  | { status: "formatted"; text: string }
  | { status: "unsupported"; message: string }
  | { status: "failed"; message: string };

type Parser = {
  parser: string;
  plugins: () => Promise<unknown[]>;
};

const estree = () => import("prettier/plugins/estree");
const typescript: Parser = {
  parser: "typescript",
  plugins: async () => [
    await import("prettier/plugins/typescript"),
    await estree(),
  ],
};
const babel = (parser: string): Parser => ({
  parser,
  plugins: async () => [await import("prettier/plugins/babel"), await estree()],
});
const postcss = (parser: string): Parser => ({
  parser,
  plugins: async () => [await import("prettier/plugins/postcss")],
});

/** What Prettier parses a file as, by its name; `null`: not a file Prettier formats here. */
export function parserOf(path: string): Parser | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";
  switch (extension) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return typescript;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return babel("babel");
    case "json":
      return babel(name === "package.json" ? "json-stringify" : "json");
    case "css":
      return postcss("css");
    case "scss":
      return postcss("scss");
    case "less":
      return postcss("less");
    case "md":
      return {
        parser: "markdown",
        plugins: async () => [await import("prettier/plugins/markdown")],
      };
    case "html":
      return {
        parser: "html",
        plugins: async () => [await import("prettier/plugins/html")],
      };
    case "yaml":
    case "yml":
      return {
        parser: "yaml",
        plugins: async () => [await import("prettier/plugins/yaml")],
      };
    default:
      return null;
  }
}

/** Config files Prettier reads that the tab cannot. */
const UNREADABLE_CONFIGS = [
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.ts",
  ".prettierrc.mts",
  ".prettierrc.cts",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.mts",
  "prettier.config.cts",
  ".prettierrc.toml",
];

type ConfigOutcome =
  | { status: "found"; options: Record<string, unknown> }
  | { status: "unsupported"; message: string };

/**
 * The Prettier options for `path`: the nearest config in a directory at or
 * above it, as Prettier finds them. No config anywhere is Prettier's defaults.
 */
export function prettierConfigOf(
  project: Record<string, string>,
  path: string,
): ConfigOutcome {
  const parts = path.split("/").slice(0, -1);
  for (let depth = parts.length; depth >= 0; depth--) {
    const dir = parts.slice(0, depth).join("/");
    const at = (file: string) => (dir === "" ? file : `${dir}/${file}`);
    const packageJson = project[at("package.json")];
    if (packageJson !== undefined) {
      const field = readJson(packageJson)?.["prettier"];
      if (typeof field === "string") {
        return {
          status: "unsupported",
          message: `${at("package.json")} names a shared Prettier config (${field}), which the tab cannot load.`,
        };
      }
      if (isRecord(field)) return withoutPlugins(field, at("package.json"));
    }
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      const text = project[at(name)];
      if (text === undefined) continue;
      const options = readJson(text);
      if (options === null) {
        return {
          status: "unsupported",
          message: `${at(name)} is not JSON (YAML, perhaps), which the tab cannot read.`,
        };
      }
      return withoutPlugins(options, at(name));
    }
    const unreadable = UNREADABLE_CONFIGS.find(
      (name) => project[at(name)] !== undefined,
    );
    if (unreadable !== undefined) {
      return {
        status: "unsupported",
        message: `The project's Prettier config is ${at(unreadable)}, which the tab cannot run.`,
      };
    }
  }
  return { status: "found", options: {} };
}

function withoutPlugins(
  options: Record<string, unknown>,
  file: string,
): ConfigOutcome {
  const plugins = options["plugins"];
  if (Array.isArray(plugins) && plugins.length > 0) {
    return {
      status: "unsupported",
      message: `${file} uses Prettier plugins (${plugins.join(", ")}), which the tab cannot load.`,
    };
  }
  // Overrides apply per file pattern, which this does not match: say so
  // rather than format some files the wrong way.
  if (Array.isArray(options["overrides"]) && options["overrides"].length > 0) {
    return {
      status: "unsupported",
      message: `${file} has overrides per file, which the tab does not apply.`,
    };
  }
  return { status: "found", options };
}

/** `text` formatted as the project formats `path`. */
export async function formatWithProjectPrettier(
  text: string,
  path: string,
  project: Record<string, string>,
): Promise<FormatOutcome> {
  const parser = parserOf(path);
  if (parser === null) {
    return {
      status: "unsupported",
      message: `Prettier does not format ${path} here.`,
    };
  }
  const config = prettierConfigOf(project, path);
  if (config.status === "unsupported") return config;
  try {
    const [prettier, plugins] = await Promise.all([
      import("prettier/standalone"),
      parser.plugins(),
    ]);
    const formatted = await prettier.format(text, {
      ...config.options,
      filepath: path,
      parser: parser.parser,
      plugins: plugins.filter(isPrettierPlugin),
    });
    return { status: "formatted", text: formatted };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function readJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What Prettier's `plugins` takes: each plugin module is an object. */
function isPrettierPlugin(value: unknown): value is import("prettier").Plugin {
  return typeof value === "object" && value !== null;
}
