// Tailwind v4, compiled in the same place the rest of the build happens.
//
// Tailwind v3 was PostCSS plus a config file plus a filesystem scan, none of
// which this platform has. v4 is a different shape and that is what makes it
// possible: the core package has *zero dependencies*, its entry is
// `compile(css, opts)` returning something with `.build(candidates)`, and the
// only thing it needs from outside is a way to resolve `@import "tailwindcss"`.
//
// Two things it does NOT get here, and both are deliberate:
//
//   - `@tailwindcss/oxide`, the native Rust scanner that finds class names in
//     source files. There is no native module in a browser tab, so candidates
//     are extracted by the regex below.
//   - a filesystem. Tailwind's own stylesheets are inlined into the generated
//     module instead, which is why they are part of the pinned vendor set
//     rather than something a project supplies.
import { compile } from "tailwindcss";
import { TAILWIND_SOURCES } from "./tailwindSources.gen";

/** Does this stylesheet ask for Tailwind at all? */
export const usesTailwind = (css: string) =>
  /@import\s+["']tailwindcss/.test(css) || /@tailwind\s+\w/.test(css);

/**
 * Directives that need something this build does not have.
 *
 * `@plugin` and `@config` both go through Tailwind's `loadModule`, which means
 * resolving and *executing* a JS module at CSS-compile time. That is a real
 * feature gap rather than a shortcut -- and a solvable one, since a plugin is a
 * dependency the project declares and the vendor layer already builds those --
 * but it is not built, so it fails loudly.
 *
 * `@source` is different: it points the scanner at paths, and candidates here
 * come from the project's files rather than from a glob. Harmless to ignore,
 * worth saying so.
 */
const UNSUPPORTED = [
  [
    "@source",
    "points the scanner at paths; candidates come from the project files here",
  ],
] as const;

/**
 * Loads a JS module for `@plugin` / `@config`.
 *
 * Tailwind resolves and *executes* these while compiling CSS, which is the one
 * thing this build cannot do on its own: there is no module resolution here,
 * only a fixed set of externals. So it is a capability the caller supplies --
 * `packages/publish` has a real filesystem and node_modules and passes one; a
 * browser build has neither and does not.
 *
 * Absent, this throws rather than returning an empty plugin. A plugin that
 * silently does nothing leaves a page subtly unstyled, which is much harder to
 * diagnose than a build that stops and names the directive -- and it would make
 * the same project build differently depending on where it was published.
 */
type CompileOptions = NonNullable<Parameters<typeof compile>[1]>;

/**
 * Derived from Tailwind's own option rather than restated.
 *
 * It used to be restated -- `(id, base, hint: string) => Promise<{ module:
 * unknown; base: string }>` -- and the restatement was WRONG: Tailwind also
 * wants a `path`, and the loader in the CLI never sent one. Nothing caught it
 * because the package this came from ran under `--experimental-strip-types`,
 * which strips types without checking them, so the mismatch was invisible on
 * both sides of the call.
 *
 * Derived, a Tailwind upgrade that changes the shape is a compile error here
 * -- which is where it can be read -- rather than an `undefined` handed to
 * someone else's code.
 */
export type CssModuleLoader = NonNullable<CompileOptions["loadModule"]>;

/** What a `@plugin` / `@config` module has to be, once it is loaded. */
export type LoadedCssModule = Awaited<ReturnType<CssModuleLoader>>["module"];

const refuseModule = (): CssModuleLoader => (id, _base, hint) => {
  throw new Error(
    `Tailwind's '@${hint}' is not supported here: '${id}' would have to be resolved and ` +
      `executed while compiling CSS, and this build has no module loader for that. ` +
      `Publishing through the CLI does support it; a browser build does not. ` +
      `Otherwise, remove the directive or express it with @theme/@utility/@custom-variant.`,
  );
};

/**
 * Characters that can appear in a Tailwind candidate.
 *
 * Tailwind's real extractor is a Rust state machine over arbitrary text; this
 * is the same idea with a blunter instrument. It over-supplies heavily -- every
 * identifier in the source becomes a candidate -- and that is the safe
 * direction, because `build()` silently drops anything it does not recognise
 * while a missed candidate is a missing style with no error anywhere.
 *
 * Includes `:` for variants (`hover:`, `md:`), `[` `]` and `(` `)` for
 * arbitrary values (`w-[32px]`, `bg-(--brand)`), `/` for opacity (`bg-red-500/50`),
 * `!` and `-` for modifiers.
 */
const CANDIDATE = /[A-Za-z0-9_@!.:/%[\]()#&$*+,<>=^~|-]+/g;

/** Source extensions worth scanning. Stylesheets are the input, not a source. */
const SCANNABLE = /\.(tsx?|jsx?|mdx?|html|svelte|vue)$/;

/**
 * Candidates for `build()`, extracted from the project's own source.
 *
 * Every string in every module, not just JSX class attributes: a class name can
 * be built anywhere -- a `cn()` helper, a lookup table, a constant in another
 * file -- and Tailwind's own scanner makes the same choice for the same reason.
 */
export function scanCandidates(files: Record<string, string>): Array<string> {
  const found = new Set<string>();
  for (const [path, code] of Object.entries(files)) {
    if (!SCANNABLE.test(path)) continue;
    for (const match of code.matchAll(CANDIDATE)) found.add(match[0]);
  }
  return [...found];
}

export interface TailwindResult {
  css: string;
  /** Directives this build cannot honour, as messages for the caller. */
  warnings: Array<string>;
  candidates: number;
  ms: number;
}

/**
 * Resolves `@import "tailwindcss"` and friends from the inlined stylesheets.
 *
 * Tailwind asks for these by package-relative id (`tailwindcss`,
 * `tailwindcss/theme.css`). Anything else is a project stylesheet, which the
 * CSS pass has already inlined by the time this runs -- so an unresolved id
 * here is a genuine error rather than something to paper over.
 */
async function loadStylesheet(id: string) {
  const name =
    id.replace(/^tailwindcss\/?/, "").replace(/\.css$/, "") || "index";
  const content = TAILWIND_SOURCES[name];
  if (content === undefined) {
    throw new Error(
      `Tailwind asked for '${id}', which this build does not carry. ` +
        `Available: ${Object.keys(TAILWIND_SOURCES).join(", ")}.`,
    );
  }
  return { path: `tailwindcss/${name}.css`, base: "/", content };
}

/**
 * Runs the project's stylesheet through Tailwind.
 *
 * The input is the *already concatenated* project CSS, so a project's own rules
 * and its `@import "tailwindcss"` are compiled together and the cascade order
 * the CSS pass worked out is preserved.
 */
export async function compileTailwind(
  css: string,
  files: Record<string, string>,
  loadModule?: CssModuleLoader,
): Promise<TailwindResult> {
  const started = performance.now();

  const warnings: Array<string> = [];
  for (const [directive, why] of UNSUPPORTED) {
    if (new RegExp(`^\\s*${directive}\\b`, "m").test(css)) {
      warnings.push(`'${directive}' is not supported: it ${why}.`);
    }
  }

  const compiler = await compile(css, {
    base: "/",
    loadStylesheet,
    loadModule: loadModule ?? refuseModule(),
  });
  const candidates = scanCandidates(files);

  return {
    css: compiler.build(candidates),
    warnings,
    candidates: candidates.length,
    ms: performance.now() - started,
  };
}
