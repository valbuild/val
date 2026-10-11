import type { CatalogTemplate } from "./catalog";
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
 * The frameworks, in the order the picker offers them.
 *
 * TanStack Start first, and the default: it is Val's primary platform, the one
 * that gets a feature first. Which TEMPLATES exist for each is not decided
 * here but by the catalog (`catalog.ts`); this is only what a flag can name.
 */
export const FRAMEWORKS: Framework[] = ["tanstack", "nextjs"];

export const FRAMEWORK_NAMES: Record<Framework, string> = {
  tanstack: "TanStack Start",
  nextjs: "Next.js",
};

export const DEFAULT_FRAMEWORK: Framework = "tanstack";

function isFramework(value: string): value is Framework {
  return FRAMEWORKS.some((framework) => framework === value);
}

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
 * Read `--template <id>` (or `--template=<id>`) out of `args`.
 *
 * Kept as the text that was given: what it names depends on the catalog, which
 * is not fetched yet when the arguments are parsed. See `resolveTemplateArg`.
 */
export function parseTemplateArgs(args: string[]): {
  template: string | null;
  /** `--template` with nothing after it. */
  invalidFlag: string | null;
  rest: string[];
} {
  let template: string | null = null;
  let invalidFlag: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--template") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        invalidFlag = invalidFlag ?? arg;
        continue;
      }
      template = value;
      i++;
      continue;
    }
    const valueMatch = /^--template=(.*)$/.exec(arg);
    if (valueMatch) {
      if (valueMatch[1] === "") {
        invalidFlag = invalidFlag ?? arg;
      } else {
        template = valueMatch[1];
      }
      continue;
    }
    rest.push(arg);
  }
  return { template, invalidFlag, rest };
}

export type TemplateArg =
  /** Names one template. */
  | { status: "ok"; template: CatalogTemplate }
  /** A name like `full`, which needs the framework before it names one. */
  | { status: "needs-framework"; name: string }
  | { status: "error"; message: string };

/**
 * What `--template` names, once the catalog is known.
 *
 * An id names one template outright, and with it the framework — so
 * `--template tanstack-full` needs no `--framework`, and contradicts a
 * `--framework nextjs` given beside it. A template's name (`full`, `Minimal`)
 * names one per framework, so it waits for the framework to be known.
 */
export function resolveTemplateArg(
  value: string,
  templates: CatalogTemplate[],
  framework: Framework | null,
): TemplateArg {
  const wanted = value.trim().toLowerCase();
  const byId = templates.find((template) => template.id === wanted);
  if (byId) {
    if (framework !== null && byId.framework !== framework) {
      return {
        status: "error",
        message: `--template ${value} is a ${FRAMEWORK_NAMES[byId.framework]} template, and --framework asked for ${FRAMEWORK_NAMES[framework]}.`,
      };
    }
    return { status: "ok", template: byId };
  }
  const named = templates.filter(
    (template) => template.name.toLowerCase() === wanted,
  );
  if (named.length === 0) {
    return {
      status: "error",
      message: `There is no template called "${value}". Templates: ${templates
        .map((template) => template.id)
        .join(", ")}.`,
    };
  }
  if (framework === null) {
    return { status: "needs-framework", name: wanted };
  }
  const forFramework = named.find(
    (template) => template.framework === framework,
  );
  if (!forFramework) {
    return {
      status: "error",
      message: `There is no ${FRAMEWORK_NAMES[framework]} template called "${value}". ${FRAMEWORK_NAMES[framework]} templates: ${templates
        .filter((template) => template.framework === framework)
        .map((template) => template.id)
        .join(", ")}.`,
    };
  }
  return { status: "ok", template: forFramework };
}

/**
 * Turn off whatever the chosen template has no files for.
 *
 * Resolved rather than refused, for the reason `reconcile` gives about
 * `--image-uploads`: the answer is not ambiguous. A flag that asked for MCP is
 * still reported, because a scripted setup that asked for something and did
 * not get it should be told so rather than find out from the finished project.
 */
export function dropUnsupportedFeatures(
  features: Features,
  template: CatalogTemplate,
): { features: Features; warning: string | null } {
  const hasMcp = template.features.mcp !== undefined;
  const hasImageUploads = template.features.imageUploads !== undefined;
  const mcp = features.mcp && hasMcp;
  const imageUploads = features.imageUploads && mcp && hasImageUploads;
  const name = `${FRAMEWORK_NAMES[template.framework]} ${template.name}`;
  if ((features.mcp || features.imageUploads) && !hasMcp) {
    return {
      features: { mcp: false, imageUploads: false },
      warning: `The ${name} template does not ship an MCP endpoint, so MCP and image uploads are off for this project.`,
    };
  }
  if (features.imageUploads && mcp && !hasImageUploads) {
    return {
      features: { mcp, imageUploads: false },
      warning: `The ${name} template does not ship image uploads, so they are off for this project.`,
    };
  }
  return { features: { mcp, imageUploads }, warning: null };
}
