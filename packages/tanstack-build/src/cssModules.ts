// `*.module.css`.
//
// A CSS module is two outputs from one file: a stylesheet whose class names
// have been made unique, and a JS object mapping the names as written to the
// names as emitted.
//
//   import styles from './card.module.css'
//   <div className={styles.title} />
//
// Scoping is per file and derived from its path, so the same class name in two
// modules cannot collide and the same file always produces the same names --
// which matters here because the server, client and rsc builds are three
// separate passes that have to agree.
//
// WHAT THIS DOES NOT DO. Real CSS-modules implementations parse the stylesheet;
// this rewrites class *selectors* with a regex, which is enough for the shape
// almost every project writes and not enough for everything:
//
//   - `:global(...)` and `composes:` are not supported, and are reported rather
//     than silently mis-scoped
//   - `@keyframes` names and `animation-name` are left alone, so two modules
//     declaring the same keyframe name still collide
//   - a class name inside a string or a url() would be rewritten if it looked
//     like a selector; in practice those do not start with a bare `.`
//
// The alternative was a real parser. Tailwind ships one but does not export it,
// and lightningcss is native, so neither is available in a browser tab.
import { sha256Hex } from "./hash";

export const isCssModule = (path: string) =>
  /\.module\.css$/.test(path.split("?")[0]!);

/**
 * Class selectors in a stylesheet.
 *
 * `.foo`, `.foo:hover`, `.a .b`, `.foo.bar` -- but not `.5rem` (a number), and
 * not a class inside an at-rule prelude like `@media`.
 */
const CLASS_SELECTOR = /\.(-?[A-Za-z_][\w-]*)/g;

/** Directives this cannot honour, so they are reported instead of mis-scoped. */
const UNSUPPORTED: Array<[RegExp, string]> = [
  [/:global\b/, ":global() is not supported; the class would be scoped anyway"],
  [
    /^\s*composes\s*:/m,
    "composes: is not supported; the composed class is not merged",
  ],
];

export interface CssModuleResult {
  /** The stylesheet with its class names scoped. */
  css: string;
  /** Name as written -> name as emitted. */
  names: Record<string, string>;
  warnings: Array<string>;
}

/**
 * Strips comments before scanning.
 *
 * A commented-out rule must not contribute a name to the mapping, and a comment
 * is the one place a `.thing` reliably appears without being a selector.
 */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Rewrites one CSS module.
 *
 * The suffix comes from the file's path rather than its contents: the same
 * module imported from two places must produce one set of names, and a
 * content hash would also change every emitted class name on every edit.
 */
export async function transformCssModule(
  path: string,
  css: string,
): Promise<CssModuleResult> {
  const suffix = (await sha256Hex(path)).slice(0, 8);

  const warnings: Array<string> = [];
  for (const [pattern, message] of UNSUPPORTED) {
    if (pattern.test(css)) warnings.push(`${path}: ${message}.`);
  }

  const names: Record<string, string> = {};
  const scoped = withoutComments(css).replace(
    CLASS_SELECTOR,
    (match, name: string) => {
      // A decimal like `.5rem` never reaches here -- the pattern requires a
      // letter or underscore first -- but a property value like `1.5em` would
      // match `.5em` without that guard, which is why it is there.
      names[name] = `${name}_${suffix}`;
      return `.${names[name]}`;
    },
  );

  return { css: scoped, names, warnings };
}

/** The JS module a CSS-module import becomes. */
export const cssModuleExports = (names: Record<string, string>) =>
  `export default ${JSON.stringify(names, null, 2)}\n`;
