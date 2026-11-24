// `@import` inside a stylesheet.
//
// The CSS pass (css.ts) follows the JS graph: a stylesheet a module imports is
// collected, in evaluation order. What a STYLESHEET imports was left as it was
// written -- and so reached Tailwind, which resolves `@import` itself, could find
// only its own sheets, and stopped the build:
//
//   Tailwind asked for './theme/theme.css', which this build does not carry.
//
// That is the most ordinary way to lay out a Tailwind v4 project -- one entry
// sheet that imports Tailwind, the theme and the fonts -- and `vite build` takes
// it without a second thought. So the imports are inlined here, before Tailwind
// runs, the way postcss-import does it for Vite:
//
//   - a relative import is the project's own file, from the in-memory file set;
//   - a bare one is a stylesheet a dependency ships, read in CI and carried
//     across with the vendor layer (see `collectDependencyCss`);
//   - `tailwindcss` and its subpaths are left exactly as written, for Tailwind;
//   - a URL is left alone, for the browser to fetch.
//
// Inlined where the `@import` was, which is where its rules take effect in the
// cascade. A sheet already emitted is not emitted again -- postcss-import and
// Vite both de-duplicate, and a theme imported from two places should not
// declare its fonts twice.
import { dirname, resolve } from "./paths";

export interface CssImportContext {
  /** The project's files, keyed by project-relative path. */
  files: Record<string, string>;
  /** Stylesheets dependencies ship, keyed by the specifier that imports them. */
  dependencyCss: Record<string, string>;
  /**
   * Every stylesheet already emitted, by project path or by specifier. Shared
   * with the JS walk, so a sheet imported from a module AND from another sheet
   * appears once.
   */
  seen: Set<string>;
  warnings: Array<string>;
}

/**
 * A comment, or an `@import` with a quoted target -- `@import "x";`,
 * `@import 'x' layer(base);`, `@import url("x") screen;`.
 *
 * Comments are matched so they can be skipped: an `@import` inside one is
 * documentation, not an import. An unquoted `url(x)` is left for the browser,
 * which is also what it does with one.
 */
const IMPORT_OR_COMMENT =
  /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*([^;]*);/g;

const isTailwind = (specifier: string) => /^tailwindcss(\/|$)/.test(specifier);

const isUrl = (specifier: string) =>
  /^([a-z]+:)?\/\//i.test(specifier) || specifier.startsWith("data:");

const isRelative = (specifier: string) =>
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier.startsWith("/");

/**
 * What an `@import`'s conditions do to the sheet it pulls in.
 *
 * `layer(name)` puts it in a cascade layer, `supports(...)` behind a feature
 * query and anything left over is a media query -- so inlining has to keep
 * each as the block it would have been, or the rules would apply everywhere.
 */
function wrap(css: string, conditions: string) {
  let rest = conditions.trim();
  let layer: string | null = null;
  let supports: string | null = null;

  const layerMatch = /^layer(?:\(([^)]*)\))?/.exec(rest);
  if (layerMatch) {
    layer = (layerMatch[1] ?? "").trim();
    rest = rest.slice(layerMatch[0].length).trim();
  }
  const supportsMatch = /^supports\(((?:[^()]|\([^()]*\))*)\)/.exec(rest);
  if (supportsMatch) {
    supports = supportsMatch[1]!.trim();
    rest = rest.slice(supportsMatch[0].length).trim();
  }

  let out = css;
  if (layer !== null) out = `@layer${layer ? ` ${layer}` : ""} {\n${out}\n}`;
  if (supports !== null) out = `@supports (${supports}) {\n${out}\n}`;
  if (rest) out = `@media ${rest} {\n${out}\n}`;
  return out;
}

/** `@config "x"` / `@plugin 'x'`, with the quote and the id captured. */
const MODULE_DIRECTIVE_OR_COMMENT =
  /\/\*[\s\S]*?\*\/|(@(?:config|plugin)\s+)(["'])([^"']+)\2/g;

/**
 * `@config` / `@plugin` ids, made relative to the project root rather than to
 * the sheet that wrote them.
 *
 * Tailwind resolves a relative `@config "../tailwind.config.js"` against the
 * directory of the stylesheet it is in -- `@tailwindcss/vite` compiles each
 * sheet with that sheet's directory as its `base`. Here the sheets are
 * concatenated before Tailwind sees them (so the cascade comes out in the
 * order the CSS pass found it), and the directory of each is gone by the time
 * Tailwind runs. So it is applied here, where it is still known: the id is
 * rewritten to the same file named from the project root, and Tailwind is
 * compiled with the project root as its `base` (see `compileTailwind`).
 *
 * The first site moved onto Val failed its first publish on exactly this:
 * `@config '../tailwind.config.js'` in `src/styles.css` was resolved from `/`.
 *
 * A bare id (`@plugin "@tailwindcss/typography"`) is a package, resolved from
 * node_modules wherever it is written, and is left alone. So is an absolute
 * one.
 */
export function rebaseModuleDirectives(path: string, css: string): string {
  const from = dirname(path).split("/").filter(Boolean);
  return css.replace(
    MODULE_DIRECTIVE_OR_COMMENT,
    (
      match,
      directive: string | undefined,
      quote: string | undefined,
      id: string | undefined,
    ) => {
      if (directive === undefined || quote === undefined || id === undefined)
        return match;
      if (!id.startsWith("./") && !id.startsWith("../")) return match;
      // Not `resolve`, which stops at the root: a config one level above the
      // project (a monorepo's shared one) has to stay one level above it,
      // rather than turn into a file in the project that does not exist.
      const segments = [...from];
      let above = 0;
      for (const segment of id.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
          if (segments.length > 0) segments.pop();
          else above++;
        } else segments.push(segment);
      }
      const rebased =
        (above > 0 ? "../".repeat(above) : "./") + segments.join("/");
      return `${directive}${quote}${rebased}${quote}`;
    },
  );
}

/**
 * The stylesheet at `path`, with every `@import` it can resolve inlined.
 *
 * `path` is the project path of the sheet, or the specifier of a dependency's
 * sheet. A dependency's own relative imports were flattened when it was read
 * (see `collectDependencyCss`), so what is left in one is bare, if anything.
 */
export function expandCssImports(
  path: string,
  css: string,
  context: CssImportContext,
  fromDependency = false,
): string {
  // A dependency's sheet is read in CI with its own relative imports already
  // flattened; its directives, if any, name packages.
  const own = fromDependency ? css : rebaseModuleDirectives(path, css);
  return own.replace(
    IMPORT_OR_COMMENT,
    (
      match,
      quote: string | undefined,
      specifier: string | undefined,
      conditions: string | undefined,
    ) => {
      if (quote === undefined || specifier === undefined) return match;
      if (isTailwind(specifier) || isUrl(specifier)) return match;

      if (isRelative(specifier)) {
        if (fromDependency) {
          context.warnings.push(
            `'${path}' imports '${specifier}', which was not carried with it. ` +
              `Its own stylesheets are read when the vendor layer is built; ` +
              `publish again from the CLI.`,
          );
          return "";
        }
        const target = resolve(dirname(path), specifier);
        const text = context.files[target];
        if (text === undefined) {
          context.warnings.push(
            `'${path}' imports '${specifier}', and there is no '${target}' in the project.`,
          );
          return "";
        }
        if (context.seen.has(target)) return "";
        context.seen.add(target);
        return wrap(
          expandCssImports(target, text, context).trim(),
          conditions ?? "",
        );
      }

      const text = context.dependencyCss[specifier];
      if (text === undefined) {
        context.warnings.push(
          `'${path}' imports '${specifier}', a stylesheet this build does not carry. ` +
            `Is '${specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]}' ` +
            `in package.json's dependencies?`,
        );
        return "";
      }
      if (context.seen.has(specifier)) return "";
      context.seen.add(specifier);
      return wrap(
        expandCssImports(specifier, text, context, true).trim(),
        conditions ?? "",
      );
    },
  );
}
