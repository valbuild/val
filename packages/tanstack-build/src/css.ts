// CSS collection for the browser build.
//
// rolldown does not do this for us. README and ARCHITECTURE both said the
// escape hatch was `@rolldown/browser/experimental`'s `viteCSSPlugin`; that
// export does not exist in 1.2.5, and the reason is upstream:
//
//   [UNSUPPORTED_FEATURE] Bundling CSS is no longer supported
//   (experimental support has been removed). rolldown/rolldown#4271
//
// So a `.css` import has to be handled before rolldown sees it. Two pieces:
//
//   1. `moduleTypes: { '.css': 'empty' }` in the build, so the import resolves
//      to nothing and disappears from the JS graph rather than erroring. The
//      module *type* is chosen by file extension, not by what `load` returns,
//      so returning JS from a `.css` id does not work -- rolldown still tries
//      to treat it as CSS and fails.
//
//   2. This pass, which produces the stylesheet itself.
//
// Order is the whole difficulty. The cascade means the order stylesheets are
// concatenated in is semantic, and neither of rolldown's hooks gives it:
// `load` runs in parallel (for `import './a.css'` before `import './b.css'`,
// b.css loaded first in testing), and CSS modules do not appear in a chunk's
// `moduleIds` at all once they are typed `empty`.
//
// So the order is derived here instead, from the source: parse each module,
// read its imports in the order they are written, and walk depth-first
// emitting dependencies before the module that imported them. That is ESM
// evaluation order, which is what a bundler would have used.
import { parseAstAsync } from "@rolldown/browser/parseAst";
import { dirname, resolve, resolveInFiles } from "./paths";
import type { AliasMap } from "./tsconfigPaths";

export const CSS_EXTENSIONS = [".css"];

/**
 * Vite query suffixes. `./styles.css?url` asks for the URL rather than the
 * contents, but it still means "this stylesheet belongs to the page" -- so the
 * CSS pass has to see through the query, or a project that links its own
 * stylesheet gets an empty one.
 */
const withoutQuery = (path: string) => path.split("?")[0]!;

export const isCss = (path: string) =>
  CSS_EXTENSIONS.some((ext) => withoutQuery(path).endsWith(ext));

interface Node {
  type: string;
  // See the same index signature on `Node` in ast.ts: oxc's AST is untyped here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Import sources of one module, in the order they appear in the source. */
async function importsOf(path: string, code: string): Promise<Array<string>> {
  const lang = path.endsWith(".tsx") || path.endsWith(".jsx") ? "tsx" : "ts";
  const ast = (await parseAstAsync(code, { lang }, path)) as unknown as {
    body: Array<Node>;
  };

  const sources: Array<string> = [];
  for (const statement of ast.body) {
    // Static imports and re-exports both pull a module into the graph, and
    // both can be the thing that drags a stylesheet in.
    if (
      statement.type === "ImportDeclaration" ||
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportAllDeclaration"
    ) {
      const source = statement.source as Node | null;
      // A type-only import contributes nothing at runtime, so it contributes
      // no stylesheet either.
      if (
        source?.value &&
        statement.importKind !== "type" &&
        statement.exportKind !== "type"
      ) {
        sources.push(String(source.value));
      }
    }
  }
  return sources;
}

import { isCssModule, transformCssModule } from "./cssModules";

export interface CssResult {
  /** Concatenated stylesheet in evaluation order, or '' when there is none. */
  code: string;
  /** Which files contributed, in order. Useful for reporting, not for output. */
  files: Array<string>;
  /**
   * Scoped class names per CSS module, keyed by the module's path.
   *
   * Produced here because scoping rewrites the stylesheet, and consumed by the
   * JS build, which turns each into the object the import returns.
   */
  modules: Record<string, Record<string, string>>;
  warnings: Array<string>;
}

/**
 * Walks the module graph from the entry and concatenates every stylesheet it
 * reaches, dependencies first.
 *
 * Only the user's own files are traversed: a bare specifier is a vendor
 * external, and vendor chunks carry no CSS (the vendor build has no CSS
 * pipeline either). A project that depends on a package shipping its own
 * stylesheet is therefore not covered -- see the README.
 */
export async function collectCss(
  files: Record<string, string>,
  entry: string,
  /**
   * Stylesheets a dependency ships, by the bare specifier that imports them.
   *
   * `import 'react-day-picker/style.css'` points into node_modules, which a
   * browser build does not have -- so the text is resolved in CI and carried
   * across with the project's vendor layer. See packages/publish.
   */
  dependencyCss: Record<string, string> = {},
  /**
   * tsconfig `paths`, because this walk resolves imports itself.
   *
   * Not optional in practice. An aliased import looks like a bare specifier,
   * so without this the walk stops at `@/components/Card` -- the component is
   * never visited, its `card.module.css` is never compiled, and the JS build
   * then hands the component an undefined styles object. The page renders as a
   * blank Suspense boundary and the build reports nothing. That is exactly how
   * it failed the first time the kitchen sink used an alias.
   */
  aliases: AliasMap | null = null,
): Promise<CssResult> {
  const visited = new Set<string>();
  const sheets: Array<string> = [];
  const contributing: Array<string> = [];
  const modules: Record<string, Record<string, string>> = {};
  const warnings: Array<string> = [];

  async function walk(path: string) {
    if (visited.has(path)) return;
    visited.add(path);

    if (isCss(path)) {
      const bare = withoutQuery(path);
      const text = files[bare] ?? "";
      if (isCssModule(bare)) {
        const scoped = await transformCssModule(bare, text);
        modules[bare] = scoped.names;
        warnings.push(...scoped.warnings);
        sheets.push(scoped.css);
      } else {
        sheets.push(text);
      }
      contributing.push(bare);
      return;
    }

    const code = files[path];
    if (code == null) return;

    // Cheap bail-out: parsing every module on every keystroke is the cost here,
    // and a module with no import statement at all cannot reach a stylesheet.
    if (!code.includes("import") && !code.includes("export")) return;

    for (const source of await importsOf(path, code)) {
      if (!source.startsWith(".")) {
        // A bare specifier is a vendor external -- unless it names a
        // stylesheet the layer carried across, in which case it contributes
        // here just like one of the project's own.
        const bare = withoutQuery(source);
        if (isCss(bare) && bare in dependencyCss && !visited.has(bare)) {
          visited.add(bare);
          sheets.push(dependencyCss[bare]!);
          contributing.push(bare);
          continue;
        }
        // ...or a tsconfig alias, which is a bare specifier that names one of
        // the project's own files.
        const aliased = [
          ...(aliases?.candidates(bare) ?? []),
          // `baseUrl` on its own, same as the resolver: a project with
          // "baseUrl": "src" writes `import 'components/Card'`, and the
          // cascade has to follow it there too.
          ...(aliases?.baseUrlCandidate(bare)
            ? [aliases.baseUrlCandidate(bare)!]
            : []),
        ];
        for (const candidate of aliased) {
          const hit = resolveInFiles(candidate, files);
          if (hit) {
            await walk(hit);
            break;
          }
        }
        continue;
      }
      // A `?url` import of a stylesheet still contributes it; see withoutQuery.
      const resolved = resolveInFiles(
        resolve(dirname(path), withoutQuery(source)),
        files,
      );
      if (resolved) await walk(resolved);
    }
  }

  await walk(entry);

  return {
    // A trailing newline per sheet so concatenated files cannot run together
    // when the last rule has no terminator.
    code: sheets
      .map((sheet) => sheet.trim())
      .filter(Boolean)
      .join("\n"),
    files: contributing,
    modules,
    warnings,
  };
}
