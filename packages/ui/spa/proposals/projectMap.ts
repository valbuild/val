import {
  parseNextJsRoutePattern,
  tanStackSegmentsOfRoutePath,
} from "@valbuild/core";
import type { PickedElement } from "@valbuild/shared/internal";
import { withoutLockfiles } from "@valbuild/shared/publish";

/**
 * A map of the project, made by the Studio for the assistant's prompt in
 * code mode: which file serves each route, which Val modules there are and
 * which files import each `.val.ts`, and the files by directory.
 *
 * Without it every code change begins with the model finding its way --
 * `list_files`, a few `search_code`, a few `read_file`, one model reply each
 * -- before the first file it changes. With it the first reply can read the
 * files the change is in.
 *
 * Three rules the output keeps, because it is part of a prompt:
 * - It is made from the files alone, in sorted order, with no time and no
 *   counter in it: the same project gives the same text, so a provider's
 *   prompt cache holds it between turns.
 * - It has a budget (`MAX_PROJECT_MAP_CHARS`), and a project too large for
 *   it gets a coarser map, never one cut in the middle of a line.
 * - Paths are the ones the code tools take: relative to the project root.
 */

/** At most this much of the prompt is the map. */
export const MAX_PROJECT_MAP_CHARS = 12_000;

export type ProjectRoute = {
  /** `/products/[sku]`, in the vocabulary Val's routers use. */
  pattern: string;
  file: string;
  /** The `.val.ts` beside it that holds the route's content, if there is one. */
  content: string | null;
  /** A layout (or the root) around other routes, not a page of its own. */
  layout: boolean;
};

export type ProjectValFile = {
  path: string;
  /** Registered in `val.modules`: content lives in it. */
  registered: boolean;
  /** The files that import it, sorted, `.val.ts` files last. */
  importedBy: string[];
};

export type ProjectMap = {
  routes: ProjectRoute[];
  valModulesFile: string | null;
  valFiles: ProjectValFile[];
  /** The files the tree lists, sorted. */
  files: string[];
  /** Per directory, how many files are media and fonts rather than code. */
  assets: Record<string, number>;
};

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const VAL_FILE = /\.val\.[jt]sx?$/;
const ASSET_FILE =
  /\.(?:png|jpe?g|svg|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|mov|m3u8|mp3|wav|ogg|pdf|zip|gz|wasm|map)$/i;
/** Written by a tool, never by hand: reading or changing them helps no one. */
const GENERATED_FILE =
  /(?:^|\/)(?:routeTree\.gen\.[jt]s|next-env\.d\.ts|[^/]+\.gen\.[jt]sx?|[^/]+\.min\.(?:js|css))$/;
const SKIPPED_DIRECTORY =
  /(?:^|\/)(?:node_modules|dist|build|out|coverage|\.git|\.next|\.output|\.tanstack|\.vercel|\.wrangler|\.turbo|\.cache)\//;
/** Longer than this is minified or generated, and is not parsed for imports. */
const MAX_PARSED_CHARS = 300_000;

const IMPORT =
  /(?:\bimport|\bexport)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

function directoryOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `a/b/../c` and `./a` as the project names them. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON as a `tsconfig.json` writes it: with comments and trailing commas. */
function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(
        text
          .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "$1")
          .replace(/,(\s*[}\]])/g, "$1"),
      );
    } catch {
      return null;
    }
  }
}

/** `"#/*": ["./src/*"]` as [prefix, target directory] pairs. */
function importAliases(project: Record<string, string>): [string, string][] {
  const aliases: [string, string][] = [];
  for (const file of ["tsconfig.json", "jsconfig.json"]) {
    const text = project[file];
    if (text === undefined) continue;
    const config = parseLooseJson(text);
    const options = isRecord(config) ? config["compilerOptions"] : null;
    if (!isRecord(options)) continue;
    const baseUrl =
      typeof options["baseUrl"] === "string" ? options["baseUrl"] : ".";
    const paths = options["paths"];
    if (!isRecord(paths)) continue;
    for (const [pattern, targets] of Object.entries(paths)) {
      const target = Array.isArray(targets) ? targets[0] : undefined;
      if (typeof target !== "string") continue;
      if (!pattern.endsWith("*") || !target.endsWith("*")) continue;
      aliases.push([
        pattern.slice(0, -1),
        normalize(`${baseUrl}/${target.slice(0, -1)}`),
      ]);
    }
  }
  // The longest prefix first, so `@/components/*` wins over `@/*`.
  return aliases.sort((a, b) => b[0].length - a[0].length);
}

const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

/** The project file an import names, or `null` for a package or a miss. */
function resolveImport(
  specifier: string,
  from: string,
  project: Record<string, string>,
  aliases: [string, string][],
): string | null {
  let base: string | null = null;
  if (specifier.startsWith(".")) {
    base = normalize(`${directoryOf(from)}/${specifier}`);
  } else {
    for (const [prefix, target] of aliases) {
      if (specifier.startsWith(prefix)) {
        base = normalize(`${target}/${specifier.slice(prefix.length)}`);
        break;
      }
    }
  }
  if (base === null) return null;
  // `./x.js` in TypeScript names `./x.ts`.
  const bases = /\.[cm]?js$/.test(base)
    ? [base, base.replace(/\.[cm]?js$/, "")]
    : [base];
  for (const candidate of bases) {
    for (const suffix of RESOLVE_SUFFIXES) {
      if (project[candidate + suffix] !== undefined) return candidate + suffix;
    }
  }
  return null;
}

function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

/** `.val.ts` files after everything else, each group sorted. */
function importersInOrder(paths: Iterable<string>): string[] {
  return [...paths].sort((a, b) => {
    const aVal = VAL_FILE.test(a);
    const bVal = VAL_FILE.test(b);
    if (aVal !== bVal) return aVal ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

const TANSTACK_ROUTE_DIRECTORIES = ["src/routes", "app/routes", "routes"];

function tanStackRoutesDirectory(
  project: Record<string, string>,
  paths: string[],
): string | null {
  const candidates = [...TANSTACK_ROUTE_DIRECTORIES];
  const config =
    project["tsr.config.json"] !== undefined
      ? parseLooseJson(project["tsr.config.json"])
      : null;
  if (isRecord(config) && typeof config["routesDirectory"] === "string") {
    candidates.unshift(normalize(config["routesDirectory"]));
  }
  // `routes/__root` is what makes a directory TanStack's: Remix and others
  // have a `routes` directory too.
  for (const directory of candidates) {
    if (paths.some((path) => path.startsWith(`${directory}/__root.`))) {
      return directory;
    }
  }
  return null;
}

function tanStackRoutes(
  directory: string,
  paths: string[],
  project: Record<string, string>,
): ProjectRoute[] {
  const routes: ProjectRoute[] = [];
  for (const path of paths) {
    if (!path.startsWith(`${directory}/`)) continue;
    if (!SOURCE_FILE.test(path) || VAL_FILE.test(path)) continue;
    if (GENERATED_FILE.test(path)) continue;
    const relative = path
      .slice(directory.length + 1)
      .replace(/\.[cm]?[jt]sx?$/, "");
    const raw = relative.split("/").flatMap((part) => part.split("."));
    // TanStack ignores files and folders that start with `-`.
    if (relative.split("/").some((part) => part.startsWith("-"))) continue;
    const last = raw[raw.length - 1] ?? "";
    const withoutExtension = path.replace(/\.[cm]?[jt]sx?$/, "");
    const content =
      [".val.ts", ".val.tsx", ".val.js"]
        .map((suffix) => withoutExtension + suffix)
        .find((candidate) => project[candidate] !== undefined) ?? null;
    routes.push({
      pattern: `/${tanStackSegmentsOfRoutePath(relative).join("/")}`,
      file: path,
      content,
      layout: last.startsWith("_") || last === "route",
    });
  }
  return routes;
}

const NEXT_APP_FILE =
  /^(?:src\/)?app\/(?:(.+)\/)?(page|layout|route)\.[cm]?[jt]sx?$/;

function nextRoutes(
  paths: string[],
  project: Record<string, string>,
): ProjectRoute[] {
  const routes: ProjectRoute[] = [];
  for (const path of paths) {
    const match = NEXT_APP_FILE.exec(path);
    if (match === null) continue;
    const kind = match[2];
    // The parser reads a page's path: a layout or a route handler serves
    // the same URL as the page that would sit beside it.
    const asPage = `/${directoryOf(path)}/page.tsx`;
    const segments =
      match[1] === undefined ? [] : parseNextJsRoutePattern(asPage);
    const content =
      kind === "page"
        ? ([".val.ts", ".val.tsx", ".val.js"]
            .map((suffix) => `${directoryOf(path)}/page${suffix}`)
            .find((candidate) => project[candidate] !== undefined) ?? null)
        : null;
    routes.push({
      pattern: `/${segments.join("/")}`,
      file: path,
      content,
      layout: kind === "layout",
    });
  }
  return routes;
}

const VAL_MODULES_FILES = [
  "val.modules.ts",
  "val.modules.js",
  "src/val.modules.ts",
  "src/val.modules.js",
];

/** The map of a project, as the code tools read it (`readProject`). */
export function buildProjectMap(project: Record<string, string>): ProjectMap {
  const kept = withoutLockfiles(project);
  const paths = Object.keys(kept)
    .filter((path) => !SKIPPED_DIRECTORY.test(`${path}`))
    .sort();
  const aliases = importAliases(project);

  const importedBy = new Map<string, Set<string>>();
  const registered = new Set<string>();
  const valModulesFile =
    VAL_MODULES_FILES.find((path) => project[path] !== undefined) ?? null;
  for (const path of paths) {
    if (!SOURCE_FILE.test(path) || GENERATED_FILE.test(path)) continue;
    const text = project[path];
    if (text === undefined || text.length > MAX_PARSED_CHARS) continue;
    // Cheap, and most files of a large project import no `.val`.
    if (!text.includes(".val")) continue;
    for (const specifier of importsOf(text)) {
      if (!specifier.includes(".val")) continue;
      const target = resolveImport(specifier, path, project, aliases);
      if (target === null || !VAL_FILE.test(target)) continue;
      if (path === valModulesFile) {
        registered.add(target);
        continue;
      }
      const importers = importedBy.get(target) ?? new Set<string>();
      importers.add(path);
      importedBy.set(target, importers);
    }
  }

  const valFiles: ProjectValFile[] = paths
    .filter((path) => VAL_FILE.test(path))
    .map((path) => ({
      path,
      registered: registered.has(path),
      importedBy: importersInOrder(importedBy.get(path) ?? []),
    }));

  const tanStackDirectory = tanStackRoutesDirectory(project, paths);
  const routes = (
    tanStackDirectory !== null
      ? tanStackRoutes(tanStackDirectory, paths, project)
      : nextRoutes(paths, project)
  ).sort(
    (a, b) =>
      (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0) ||
      Number(b.layout) - Number(a.layout) ||
      (a.file < b.file ? -1 : 1),
  );

  const files: string[] = [];
  const assets: Record<string, number> = {};
  for (const path of paths) {
    if (GENERATED_FILE.test(path)) continue;
    if (ASSET_FILE.test(path)) {
      const directory = directoryOf(path);
      assets[directory] = (assets[directory] ?? 0) + 1;
      continue;
    }
    files.push(path);
  }
  return { routes, valModulesFile, valFiles, files, assets };
}

/** `./Hero.tsx` beside it, the whole path from anywhere else. */
function relativeTo(path: string, from: string): string {
  return directoryOf(path) === directoryOf(from) ? `./${baseOf(path)}` : path;
}

function capped(lines: string[], cap: number, what: string): string[] {
  if (lines.length <= cap) return lines;
  return [
    ...lines.slice(0, cap),
    `(+${lines.length - cap} more ${what}: search_code finds them)`,
  ];
}

/** How much of the map is written: less of each as the project grows. */
type Detail = {
  /** Rows of routes, and of `.val.ts` files. */
  rows: number;
  /** Importers named for one `.val.ts`. */
  importers: number;
  /** Files named in one directory; the rest are counted. */
  filesPerDirectory: number;
  /** Directories deeper than this are counted into the one above. */
  depth: number;
};

const DETAILS: Detail[] = [
  { rows: 200, importers: 8, filesPerDirectory: 60, depth: 99 },
  { rows: 120, importers: 5, filesPerDirectory: 24, depth: 99 },
  { rows: 80, importers: 4, filesPerDirectory: 12, depth: 6 },
  { rows: 60, importers: 3, filesPerDirectory: 6, depth: 4 },
  { rows: 40, importers: 2, filesPerDirectory: 0, depth: 3 },
  { rows: 20, importers: 1, filesPerDirectory: 0, depth: 2 },
  { rows: 10, importers: 0, filesPerDirectory: 0, depth: 1 },
];

function routeLines(map: ProjectMap, detail: Detail): string[] {
  return capped(
    map.routes.map(
      (route) =>
        `${route.pattern}${route.layout ? " (layout)" : ""}: ${route.file}${
          route.content !== null
            ? `, content in ${relativeTo(route.content, route.file)}`
            : ""
        }`,
    ),
    detail.rows,
    "routes",
  );
}

function valFileLines(
  files: ProjectValFile[],
  detail: Detail,
  what: string,
): string[] {
  return capped(
    files.map((file) => {
      if (file.importedBy.length === 0 || detail.importers === 0) {
        return file.path;
      }
      const named = file.importedBy
        .slice(0, detail.importers)
        .map((importer) => relativeTo(importer, file.path));
      const more = file.importedBy.length - named.length;
      return `${file.path} <- ${named.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`;
    }),
    detail.rows,
    what,
  );
}

function treeLines(map: ProjectMap, detail: Detail): string[] {
  const shown = (directory: string): string =>
    directory === ""
      ? ""
      : directory.split("/").slice(0, detail.depth).join("/");
  const named = new Map<string, string[]>();
  const below = new Map<string, number>();
  const assets = new Map<string, number>();
  const at = (directory: string) => {
    const key = shown(directory);
    if (!named.has(key)) named.set(key, []);
    return key;
  };
  for (const path of map.files) {
    const directory = directoryOf(path);
    const key = at(directory);
    if (key === directory) named.get(key)?.push(baseOf(path));
    else below.set(key, (below.get(key) ?? 0) + 1);
  }
  for (const [directory, count] of Object.entries(map.assets)) {
    const key = at(directory);
    assets.set(key, (assets.get(key) ?? 0) + count);
  }
  return [...named.keys()].sort().map((directory) => {
    const files = named.get(directory) ?? [];
    const listed = files.slice(0, detail.filesPerDirectory);
    const notes: string[] = [];
    const unlisted = files.length - listed.length;
    if (unlisted > 0) {
      notes.push(
        listed.length === 0 ? `${unlisted} files` : `+${unlisted} more files`,
      );
    }
    const deeper = below.get(directory) ?? 0;
    if (deeper > 0) notes.push(`${deeper} files in folders below`);
    const media = assets.get(directory) ?? 0;
    if (media > 0) notes.push(`${media} media files`);
    return `${directory === "" ? "." : directory}/: ${[
      ...listed,
      ...(notes.length > 0 ? [`(${notes.join(", ")})`] : []),
    ].join(", ")}`;
  });
}

function render(map: ProjectMap, detail: Detail): string[] {
  const lines: string[] = [];
  const routes = routeLines(map, detail);
  if (routes.length > 0) {
    lines.push("### Routes", ...routes, "");
  }
  const modules = map.valFiles.filter((file) => file.registered);
  const others = map.valFiles.filter((file) => !file.registered);
  if (modules.length > 0) {
    lines.push(
      `### Val modules (registered in ${map.valModulesFile ?? "val.modules"}; \`<-\` names the files that import each)`,
      ...valFileLines(modules, detail, "modules"),
      "",
    );
  }
  if (others.length > 0) {
    lines.push(
      modules.length > 0
        ? "### Other .val files (schemas the modules are built from, and the components that render them)"
        : "### .val files (`<-` names the files that import each)",
      ...valFileLines(others, detail, ".val files"),
      "",
    );
  }
  lines.push("### Files", ...treeLines(map, detail));
  return lines;
}

/**
 * The map as text, within `maxChars`: the most detailed rendering that
 * fits, and for a project no rendering fits, the coarsest one with whole
 * lines left off its end.
 */
export function projectMapText(
  map: ProjectMap,
  maxChars: number = MAX_PROJECT_MAP_CHARS,
): string {
  let lines: string[] = [];
  for (const detail of DETAILS) {
    lines = render(map, detail);
    if (lines.join("\n").length <= maxChars) return lines.join("\n");
  }
  const note = (left: number) =>
    `(${left} more lines left out: list_files with a prefix names the files of a directory)`;
  let kept = lines.length;
  while (
    kept > 0 &&
    [...lines.slice(0, kept), note(lines.length - kept)].join("\n").length >
      maxChars
  ) {
    kept--;
  }
  return [...lines.slice(0, kept), note(lines.length - kept)].join("\n");
}

/**
 * The map, as the prompt carries it. Last in the prompt: it is the part
 * that changes when files are added or moved, and everything before it
 * stays as it was.
 */
export function projectMapPromptSection(map: string | null): string {
  if (map === null || map === "") return "";
  return `

## The project's map
Made by the Studio from the project's files as it last read them, before this message: a file you add in this turn is not in it yet. Use it to go straight to the files a change is in: do not call list_files or search_code for what it already says. Paths are the ones the code tools take.

${map}`;
}

/** Where a picked element comes from in the code, as far as the tab can tell. */
export type PickedSources = {
  /** The project file of the module `path` names. */
  module?: string;
  /** The files that import that module. */
  importedBy?: string[];
  /** The files that write the element's classes as it has them. */
  classesIn?: string[];
};

const MAX_PICKED_FILES = 4;
/** A class alone names a file only when it is this particular. */
const MIN_LONE_CLASS_CHARS = 12;

/**
 * The files whose text has the longest run of the element's classes, in
 * the order the element has them: `className="relative isolate flex"` is
 * found for an element with those classes and more after them. Two classes
 * in a row at least, or one long one: `flex` alone names every file.
 */
function filesWritingClasses(
  classes: string[],
  project: Record<string, string>,
): string[] {
  const candidates = Object.keys(withoutLockfiles(project))
    .filter(
      (path) =>
        SOURCE_FILE.test(path) &&
        !VAL_FILE.test(path) &&
        !GENERATED_FILE.test(path) &&
        !SKIPPED_DIRECTORY.test(path) &&
        !/\.(?:stories|test|spec)\./.test(path),
    )
    .sort();
  for (let length = classes.length; length >= 1; length--) {
    const found = new Set<string>();
    for (let start = 0; start + length <= classes.length; start++) {
      const run = classes.slice(start, start + length).join(" ");
      if (length === 1 && run.length < MIN_LONE_CLASS_CHARS) continue;
      for (const path of candidates) {
        const text = project[path];
        if (
          text !== undefined &&
          text.length <= MAX_PARSED_CHARS &&
          text.includes(run)
        ) {
          found.add(path);
        }
      }
    }
    // Many files with the same run say nothing about which one it is.
    if (found.size > 0) {
      return found.size <= MAX_PICKED_FILES ? [...found].sort() : [];
    }
  }
  return [];
}

/**
 * What the tab can say about where a picked element is in the code, so the
 * model does not spend replies searching for it: the file of the module its
 * `path` names with the files that import it, and the files that write its
 * classes.
 */
export function pickedElementSources(
  picked: PickedElement,
  project: Record<string, string>,
  map: ProjectMap,
): PickedSources {
  const sources: PickedSources = {};
  if (picked.valPath !== undefined) {
    const moduleFilePath = picked.valPath.split("?p=")[0] ?? "";
    const file = moduleFilePath.replace(/^\//, "");
    const known = map.valFiles.find((valFile) => valFile.path === file);
    if (known !== undefined) {
      sources.module = known.path;
      if (known.importedBy.length > 0) {
        sources.importedBy = known.importedBy.slice(0, MAX_PICKED_FILES);
      }
    }
  }
  const classesIn = filesWritingClasses(picked.classes, project);
  if (classesIn.length > 0) sources.classesIn = classesIn;
  return sources;
}
