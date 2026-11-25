import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";

/**
 * `vite build` as the reference for Val's build.
 *
 * Val publishes with its own builder (`@valbuild/tanstack-build`), which
 * reads no `vite.config.ts` and runs none of its plugins. Most of what that
 * costs is SILENT: a stylesheet imported with `import()`, a `virtual:` module
 * a plugin provides, a package whose main file is CSS -- each builds, each
 * publishes, and the page is unstyled or fails to load an import later.
 * Listing every tool a project might use would never be finished, so this
 * asks the project's own Vite instead: build the client the way `pnpm build`
 * does, record how every import of the project's own files was resolved, and
 * hold Val's build against that.
 *
 * Only the client environment, and nothing is written: what is compared is
 * how imports resolve, not the output.
 */

/** One import of a project file, as Vite resolved it. */
export type ViteImport = {
  /** The importing file, relative to the root. */
  importer: string;
  /** As written. */
  specifier: string;
  /**
   * What it resolved to: a path relative to the root (inside `node_modules`
   * for a package), the plugin's id for a virtual module, or `null` when Vite
   * left it external.
   */
  resolved: string | null;
};

export type ViteReference =
  | { status: "skipped"; reason: string }
  | { status: "failed"; message: string }
  | { status: "built"; imports: ViteImport[]; plugins: string[] };

/** What Val's build reports, from `BuildOutput`. */
export type ValBuildFacts = {
  unresolvedImports: Array<{ importer: string; specifier: string }>;
  stylesheets: string[];
};

/** Something `vite build` does that Val's build does not. */
export type ViteDifference = {
  importer: string;
  specifier: string;
  message: string;
};

const VITE_CONFIGS = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cts",
  "vite.config.cjs",
];

/**
 * `import(url)`, out of reach of the CommonJS build -- the same reason as
 * `dynamicImport` in `@valbuild/tanstack-build/node`: compiled to `require`,
 * an ESM-only package by `file://` URL cannot be loaded.
 */
const importByUrl = new Function("url", "return import(url)") as (
  url: string,
) => Promise<unknown>;

/** Stylesheets, by extension, as Vite's CSS plugin takes them. */
const STYLESHEET = /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/;

const withoutQuery = (id: string) => id.split("?")[0]!;

function relativeTo(root: string, id: string): string {
  const bare = withoutQuery(id);
  if (!path.isAbsolute(bare)) return id;
  return path.relative(root, bare).split(path.sep).join("/");
}

/** A file of the project's own, not of an installed package. */
function isProjectFile(root: string, id: string): boolean {
  const bare = withoutQuery(id);
  if (!path.isAbsolute(bare)) return false;
  const rel = path.relative(root, bare);
  return (
    !rel.startsWith("..") &&
    !path.isAbsolute(rel) &&
    !rel.split(path.sep).includes("node_modules")
  );
}

type ViteModule = {
  createBuilder: (config: Record<string, unknown>) => Promise<{
    config: { plugins: ReadonlyArray<{ name: string }> };
    environments: Record<string, unknown>;
    build: (environment: unknown) => Promise<unknown>;
  }>;
};

function isViteModule(value: unknown): value is ViteModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "createBuilder" in value &&
    typeof value.createBuilder === "function"
  );
}

/** Builds the project's client with its own Vite, and records its imports. */
export async function viteReference(root: string): Promise<ViteReference> {
  root = path.resolve(root);
  const configFile = VITE_CONFIGS.find((name) =>
    fs.existsSync(path.join(root, name)),
  );
  if (configFile === undefined) {
    return { status: "skipped", reason: "the project has no vite.config" };
  }
  let vite: unknown;
  try {
    const require = createRequire(path.join(root, "package.json"));
    vite = await importByUrl(pathToFileURL(require.resolve("vite")).href);
  } catch {
    return { status: "skipped", reason: "vite is not installed" };
  }
  if (!isViteModule(vite)) {
    return {
      status: "skipped",
      reason: "the installed vite is older than 6 (no createBuilder)",
    };
  }

  const imports = new Map<string, ViteImport>();
  const observer = {
    name: "val:reference",
    enforce: "pre" as const,
    async resolveId(
      this: {
        resolve: (
          source: string,
          importer: string | undefined,
          options: Record<string, unknown>,
        ) => Promise<{ id: string; external?: boolean | string } | null>;
      },
      source: string,
      importer: string | undefined,
      options: Record<string, unknown>,
    ) {
      if (importer === undefined || !isProjectFile(root, importer)) {
        return null;
      }
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      const entry: ViteImport = {
        importer: relativeTo(root, importer),
        specifier: source,
        resolved:
          resolved === null || resolved.external
            ? null
            : relativeTo(root, resolved.id),
      };
      imports.set(`${entry.importer}\u0000${entry.specifier}`, entry);
      return resolved;
    },
  };

  try {
    const builder = await vite.createBuilder({
      root,
      configFile: path.join(root, configFile),
      logLevel: "silent",
      mode: "production",
      plugins: [observer],
      build: { write: false },
    });
    const client = builder.environments.client;
    if (client === undefined) {
      return {
        status: "skipped",
        reason: "the Vite config has no client environment",
      };
    }
    await builder.build(client);
    return {
      status: "built",
      imports: [...imports.values()],
      plugins: builder.config.plugins.map((plugin) => plugin.name),
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Where Val's build differs from the project's `vite build`, as findings a
 * person can act on.
 *
 * Two questions, both of the imports of the project's own files:
 *
 * - **Did Val leave an import unresolved that Vite resolved?** Then Val's
 *   output still imports it, and the browser or the isolate fails to load it
 *   after the publish has succeeded.
 * - **Did Vite put a stylesheet on the page that Val's stylesheet lacks?** A
 *   dynamic `import("./x.css")`, for one: Val's CSS pass follows static
 *   imports, so the import resolves to nothing and the page is unstyled,
 *   with nothing failing anywhere.
 */
export function compareWithVite(
  reference: Extract<ViteReference, { status: "built" }>,
  val: ValBuildFacts,
): ViteDifference[] {
  const byImport = new Map(
    reference.imports.map((i) => [`${i.importer}\u0000${i.specifier}`, i]),
  );
  const differences: ViteDifference[] = [];

  for (const { importer, specifier } of val.unresolvedImports) {
    const vite = byImport.get(`${importer}\u0000${specifier}`);
    if (vite === undefined || vite.resolved === null) continue;
    differences.push({
      importer,
      specifier,
      message:
        `${importer} imports '${specifier}'. Vite resolves it (to ${vite.resolved.replace(/^\0/, "")}), ` +
        `and Val's build cannot, so the published site would try to load ` +
        `'${specifier}' at runtime and fail.` +
        hintFor(specifier, vite.resolved),
    });
  }

  const onPage = new Set(val.stylesheets);
  for (const vite of reference.imports) {
    if (vite.resolved === null) continue;
    const file = withoutQuery(vite.resolved);
    if (!STYLESHEET.test(file)) continue;
    const query = vite.specifier.includes("?")
      ? vite.specifier.slice(vite.specifier.indexOf("?"))
      : "";
    // `?inline` and `?raw` are a string in JS, not a sheet on the page.
    if (/[?&](inline|raw)\b/.test(query)) continue;
    const fromPackage = file.split("/").includes("node_modules");
    const name = fromPackage ? withoutQuery(vite.specifier) : file;
    if (onPage.has(name)) continue;
    // Reported once as unresolved already.
    if (
      differences.some(
        (d) => d.importer === vite.importer && d.specifier === vite.specifier,
      )
    ) {
      continue;
    }
    differences.push({
      importer: vite.importer,
      specifier: vite.specifier,
      message:
        `${vite.importer} imports the stylesheet '${vite.specifier}', and Vite puts it ` +
        `on the page. Val's build does not, so the published site would be ` +
        `missing those styles.` +
        hintFor(vite.specifier, vite.resolved),
    });
  }
  return differences;
}

/** What to do about one difference, when there is something specific. */
function hintFor(specifier: string, resolved: string): string {
  const file = withoutQuery(resolved);
  if (/\.(scss|sass|less|styl|stylus)$/.test(file)) {
    return ` Val's build compiles plain CSS only: convert the stylesheet to CSS.`;
  }
  if (specifier.startsWith("virtual:") || resolved.startsWith("\0")) {
    return ` It is a module a Vite plugin provides, and Val's build runs no Vite plugins.`;
  }
  // `import "@fontsource/inter"`: a package whose main file is CSS. Val's
  // build knows a stylesheet by its extension.
  if (STYLESHEET.test(file) && !STYLESHEET.test(withoutQuery(specifier))) {
    return ` Import the stylesheet by its file: import "${specifier.replace(/\/$/, "")}/${path.basename(file)}".`;
  }
  if (STYLESHEET.test(file)) {
    return ` If it is imported with import(), import it statically at the top of the module.`;
  }
  return "";
}

/** Plugins Val's build does the work of itself, or that do not change output. */
const KNOWN_PLUGIN =
  /^(vite:|val:|tanstack|@tanstack|@tailwindcss\/vite|alias$|commonjs|native:|builtin:|rolldown:|oxc|tsr-|tanstack-|react-refresh|vite-tsconfig-paths)/;

/**
 * The project's Vite plugins that Val's build does not run, as one note.
 * Not an error: a plugin may do nothing the published site depends on.
 */
export function unrunPlugins(
  reference: Extract<ViteReference, { status: "built" }>,
): string[] {
  return [
    ...new Set(reference.plugins.filter((name) => !KNOWN_PLUGIN.test(name))),
  ];
}
