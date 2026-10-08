import { FRAMEWORKS, type Framework } from "./framework";

/**
 * The list of templates, as `valbuild/templates` publishes it.
 *
 * The templates repository owns what can be created: which templates exist,
 * what they are called, which framework each is for, and which files and
 * dependencies make up each optional feature. This package reads that at run
 * time rather than carrying a copy, so a template is added, renamed, moved or
 * retired by a change to `catalog.json` there, with no release of this package
 * — and admin.val.build/new reads the same file, so the two cannot offer
 * different things.
 *
 * Fetched from the same ref the template is downloaded from, so the list and
 * the files it describes are always one commit. There is no bundled fallback:
 * the catalog and the template come from the same host, and a CLI that cannot
 * reach one cannot reach the other.
 */

export const TEMPLATES_REPO = "valbuild/templates";

/**
 * Which ref of `valbuild/templates` to read, from `VAL_TEMPLATES_REF`.
 *
 * For trying out a branch of the templates before it lands — the whole point of
 * keeping them in one repository is that a change to one can be tested in all
 * of them, and this is how one is tested through `npm create` itself.
 * `HEAD` otherwise: the default branch, which is what degit takes when given
 * no ref at all.
 */
export function templatesRef(env: Record<string, string | undefined>): string {
  const ref = env.VAL_TEMPLATES_REF?.trim();
  return ref ? ref : "HEAD";
}

export type CatalogFeatures = {
  /** Present when the template serves Val's content tools at `/api/mcp`. */
  mcp?: {
    /** Files and directories that exist only to serve MCP. */
    paths: string[];
    /** Dependencies that exist only to serve MCP, `sharp` included. */
    dependencies: string[];
    /** Markdown files with a `<!-- val:mcp:start -->` … `end` region. */
    docs: string[];
  };
  /** Present when that endpoint can also upload images. */
  imageUploads?: {
    /** The file that builds the image tools, replaced when declined. */
    file: string;
    dependencies: string[];
  };
};

export type CatalogTemplate = {
  /** Stable, and what `--template` takes: `tanstack-full`. */
  id: string;
  framework: Framework;
  /** Shown in the picker: `Full`. */
  name: string;
  description: string;
  /** The template's folder in the repository: `tanstack/full`. */
  path: string;
  features: CatalogFeatures;
  /**
   * A package.json script that brings generated files up to date, run once
   * something has been removed — TanStack's route tree imports every route
   * file, including the ones a declined feature took away.
   */
  regenerate?: { script: string; files: string[] };
};

export type Catalog = { templates: CatalogTemplate[] };

export type ParsedCatalog =
  | { status: "ok"; catalog: Catalog }
  | { status: "error"; message: string };

/**
 * Check what came over the wire, and keep only what this package uses.
 *
 * By hand rather than with a schema library: this package installs before the
 * project does, on every `npm create`, and three dependencies is what it has.
 * Strict where a mistake would do damage — a path that climbs out of the
 * project is refused, because these paths are deleted — and lenient where it
 * would not: an unknown field is ignored, and so is a template for a framework
 * this version does not know, which is how a newer catalog adds one without
 * breaking older CLIs.
 */
export function parseCatalog(value: unknown): ParsedCatalog {
  if (!isRecord(value)) {
    return { status: "error", message: "the catalog is not an object" };
  }
  if (value.version !== 1) {
    return {
      status: "error",
      message: `the catalog is version ${JSON.stringify(value.version)}, and this version of @valbuild/create reads version 1. Try @valbuild/create@latest.`,
    };
  }
  if (!Array.isArray(value.templates)) {
    return { status: "error", message: "the catalog lists no templates" };
  }
  const templates: CatalogTemplate[] = [];
  for (const entry of value.templates) {
    const parsed = parseTemplate(entry);
    if (parsed === "unknown-framework") {
      continue;
    }
    if (typeof parsed === "string") {
      return { status: "error", message: parsed };
    }
    templates.push(parsed);
  }
  if (templates.length === 0) {
    return { status: "error", message: "the catalog lists no templates" };
  }
  return { status: "ok", catalog: { templates } };
}

function parseTemplate(
  entry: unknown,
): CatalogTemplate | "unknown-framework" | string {
  if (!isRecord(entry)) {
    return "a template entry is not an object";
  }
  const id = entry.id;
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) {
    return `a template has an invalid id: ${JSON.stringify(id)}`;
  }
  const where = `template "${id}"`;
  if (
    typeof entry.framework !== "string" ||
    !isKnownFramework(entry.framework)
  ) {
    return "unknown-framework";
  }
  const framework = entry.framework;
  if (typeof entry.name !== "string" || typeof entry.description !== "string") {
    return `${where} has no name or description`;
  }
  if (!isSafeRelativePath(entry.path)) {
    return `${where} has an invalid path: ${JSON.stringify(entry.path)}`;
  }
  const features: CatalogFeatures = {};
  // Absent is "no optional features". Present and not an object is a mistake,
  // and reading it as absent would make `--no-mcp` silently remove nothing.
  if (entry.features !== undefined && !isRecord(entry.features)) {
    return `${where} has an invalid features value`;
  }
  const rawFeatures = isRecord(entry.features) ? entry.features : {};
  if (rawFeatures.mcp !== undefined) {
    const mcp = rawFeatures.mcp;
    if (
      !isRecord(mcp) ||
      !isPathList(mcp.paths) ||
      !isStringList(mcp.dependencies) ||
      !isPathList(mcp.docs)
    ) {
      return `${where} has an invalid mcp feature`;
    }
    features.mcp = {
      paths: mcp.paths,
      dependencies: mcp.dependencies,
      docs: mcp.docs,
    };
  }
  if (rawFeatures.imageUploads !== undefined) {
    const imageUploads = rawFeatures.imageUploads;
    if (
      !isRecord(imageUploads) ||
      !isSafeRelativePath(imageUploads.file) ||
      !isStringList(imageUploads.dependencies)
    ) {
      return `${where} has an invalid imageUploads feature`;
    }
    if (features.mcp === undefined) {
      return `${where} has image uploads without the MCP endpoint that serves them`;
    }
    features.imageUploads = {
      file: imageUploads.file,
      dependencies: imageUploads.dependencies,
    };
  }
  const template: CatalogTemplate = {
    id,
    framework,
    name: entry.name,
    description: entry.description,
    path: entry.path,
    features,
  };
  if (entry.regenerate !== undefined) {
    const regenerate = entry.regenerate;
    if (
      !isRecord(regenerate) ||
      typeof regenerate.script !== "string" ||
      !/^[\w:.-]+$/.test(regenerate.script) ||
      !isPathList(regenerate.files)
    ) {
      return `${where} has an invalid regenerate step`;
    }
    template.regenerate = {
      script: regenerate.script,
      files: regenerate.files,
    };
  }
  return template;
}

/**
 * A path these may delete: relative, forward slashes, and never climbing out of
 * the project it is resolved against.
 */
export function isSafeRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/^[a-zA-Z]:/.test(value) &&
    // `.` too, not only `..`: `src/.` resolves to `src`, and a bare `.` to the
    // project itself, which a feature removal would then delete whole.
    !value
      .split("/")
      .some((segment) => segment === ".." || segment === "." || segment === "")
  );
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isSafeRelativePath);
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownFramework(value: string): value is Framework {
  return FRAMEWORKS.some((framework) => framework === value);
}

/** Where degit downloads a template from: `valbuild/templates/tanstack/full`. */
export function templateSource(template: CatalogTemplate, ref: string): string {
  const source = `${TEMPLATES_REPO}/${template.path}`;
  return ref === "HEAD" ? source : `${source}#${ref}`;
}

/** Where the template can be read in a browser, for messages. */
export function templateUrl(template: CatalogTemplate, ref: string): string {
  return `https://github.com/${TEMPLATES_REPO}/tree/${ref}/${template.path}`;
}

export function catalogUrl(ref: string): string {
  return `https://raw.githubusercontent.com/${TEMPLATES_REPO}/${encodeURIComponent(ref)}/catalog.json`;
}

export type FetchedCatalog =
  | { status: "ok"; catalog: Catalog }
  | { status: "error"; message: string; details?: string };

/**
 * Read the catalog, and say in a person's terms what went wrong if it cannot be.
 *
 * `fetchImpl` is for tests; the real one is Node's own `fetch`, which every
 * Node this package supports has.
 */
export async function fetchCatalog(
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedCatalog> {
  const url = catalogUrl(ref);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    return {
      status: "error",
      message:
        "Could not reach GitHub to list the templates. Run the command again to try again.",
      details: error instanceof Error ? error.message : String(error),
    };
  }
  if (response.status === 404) {
    return {
      status: "error",
      message:
        ref === "HEAD"
          ? `There is no template list at ${url}.`
          : `There is no template list on "${ref}" of ${TEMPLATES_REPO}. Check VAL_TEMPLATES_REF.`,
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      message: `GitHub answered ${response.status} when asked for the template list. Run the command again to try again.`,
      details: url,
    };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      status: "error",
      message: "The template list could not be read.",
      details: url,
    };
  }
  const parsed = parseCatalog(json);
  if (parsed.status === "error") {
    return {
      status: "error",
      message: `The template list could not be used: ${parsed.message}`,
      details: url,
    };
  }
  return parsed;
}
