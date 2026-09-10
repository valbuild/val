import type { Features } from "./features";

/**
 * Which framework the new project is built on.
 *
 * The first question, and the one every later answer depends on: it decides
 * which template is downloaded, and therefore which of the optional features
 * there is anything to turn on. A flag answers it, in which case nothing is
 * asked — same contract as the feature flags and the package manager.
 */

export type Framework = "nextjs" | "tanstack";

/**
 * The optional parts of the template a given starter actually ships.
 *
 * Not a statement about the framework package: `@valbuild/tanstack/server`
 * exports `initValMcp` just as `@valbuild/next/server` does. It is a statement
 * about the STARTER, and it exists so the prompts cannot offer a feature that
 * the downloaded repository has no files for — which would produce a project
 * whose success message points a coding agent at an endpoint that is not there.
 */
export type FeatureSupport = {
  /** Serves Val's content tools at `/api/mcp`. */
  mcp: boolean;
};

export type Template = {
  framework: Framework;
  /** Shown in the picker, and in any message that names the starter. */
  name: string;
  description: string;
  repo: string;
  supports: FeatureSupport;
};

export const TEMPLATES: Record<Framework, Template> = {
  nextjs: {
    framework: "nextjs",
    name: "Next.js",
    description: "App Router, TypeScript, Tailwind CSS, and examples",
    repo: "valbuild/template-nextjs-starter",
    supports: { mcp: true },
  },
  tanstack: {
    framework: "tanstack",
    name: "TanStack Start",
    description: "React, TypeScript, Tailwind CSS, and examples",
    repo: "valbuild/template-tanstack-starter",
    // The starter has no `api/mcp` route or `src/val/mcp.ts` yet. Flip this to
    // `true` in the same change that adds them, and `applyFeatures` will need
    // this framework's paths — the ones it removes today are Next's.
    supports: { mcp: false },
  },
};

function isFramework(value: string): value is Framework {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

/**
 * Every framework we have a starter for, derived from the templates so the two
 * cannot drift: a `Framework` added to the union without a template is a type
 * error, and one added with a template shows up in the picker, the help text
 * and the error messages for free.
 */
export const FRAMEWORKS: Framework[] =
  Object.keys(TEMPLATES).filter(isFramework);

export const DEFAULT_FRAMEWORK: Framework = "nextjs";

/**
 * What people type when they mean one of these.
 *
 * `--framework next` is what someone reaches for first, and refusing it to
 * insist on `nextjs` teaches nothing.
 */
const FRAMEWORK_ALIASES: Record<string, Framework> = {
  next: "nextjs",
  "next.js": "nextjs",
  nextjs: "nextjs",
  start: "tanstack",
  tanstack: "tanstack",
  "tanstack-start": "tanstack",
};

/** The framework this value names, or null if it names none of them. */
export function resolveFrameworkName(value: string): Framework | null {
  const key = value.trim().toLowerCase();
  if (isFramework(key)) {
    return key;
  }
  return FRAMEWORK_ALIASES[key] ?? null;
}

export type FrameworkArgs = {
  /** The framework the flags asked for, or null if none did. */
  framework: Framework | null;
  /** The first flag we could not make sense of, verbatim, for the error message. */
  invalidFlag: string | null;
  /** `args` without the framework flags, so other parsing is unaffected. */
  rest: string[];
};

/**
 * Read `--framework <name>` (or `--framework=<name>`) and the `--nextjs` /
 * `--tanstack` shorthands out of `args`.
 *
 * The last flag wins, so a later `--tanstack` overrides an earlier
 * `--framework nextjs` rather than erroring — the same rule the package
 * manager flags follow.
 */
export function parseFrameworkArgs(args: string[]): FrameworkArgs {
  let framework: Framework | null = null;
  let invalidFlag: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--framework") {
      const value = args[i + 1];
      const resolved = value === undefined ? null : resolveFrameworkName(value);
      if (resolved) {
        framework = resolved;
      } else if (invalidFlag === null) {
        invalidFlag = value === undefined ? arg : `${arg} ${value}`;
      }
      // Skip the value too, unless the flag was last and has none.
      if (value !== undefined) {
        i++;
      }
      continue;
    }
    const valueMatch = /^--framework=(.*)$/.exec(arg);
    if (valueMatch) {
      const resolved = resolveFrameworkName(valueMatch[1]);
      if (resolved) {
        framework = resolved;
      } else if (invalidFlag === null) {
        invalidFlag = arg;
      }
      continue;
    }
    // A bare `--nextjs` / `--tanstack`. Only when it names a framework we have:
    // anything else is someone else's flag and is passed through untouched.
    const shorthandMatch = /^--(.+)$/.exec(arg);
    if (shorthandMatch) {
      const resolved = resolveFrameworkName(shorthandMatch[1]);
      if (resolved) {
        framework = resolved;
        continue;
      }
    }
    rest.push(arg);
  }

  return { framework, invalidFlag, rest };
}

/**
 * Turn off whatever the chosen starter has no files for.
 *
 * Resolved rather than refused, for the reason `reconcile` gives about
 * `--image-uploads`: the answer is not ambiguous. A flag that asked for MCP is
 * still reported, because a scripted setup that asked for something and did
 * not get it should be told so rather than find out from the finished project.
 */
export function dropUnsupportedFeatures(
  features: Features,
  template: Template,
): { features: Features; warning: string | null } {
  if (template.supports.mcp || !(features.mcp || features.imageUploads)) {
    return { features, warning: null };
  }
  return {
    features: { mcp: false, imageUploads: false },
    warning: `The ${template.name} starter does not ship an MCP endpoint yet, so MCP and image uploads are off for this project.`,
  };
}
