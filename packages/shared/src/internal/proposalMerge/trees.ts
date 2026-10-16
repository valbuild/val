import type {
  ModuleFilePath,
  Schema,
  SelectorSource,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";

/**
 * Update from the site, for a proposal with code (valbuild/home
 * `docs/hosted-publishing.md` step 8.2, slice 1b): what content hands over,
 * what the builder tab makes of it, and what Val's server reads -- one
 * definition of each for the three.
 */

/** Content a schema does not allow, by path in the module. */
export type SchemaError = { path: string[]; message: string };

/** Content's `merge-trees` answer. */
export type MergeTrees = {
  base: string | null;
  siteHead: string | null;
  proposalHead: string | null;
  upToDate: boolean;
  builds: { base: string; site: string };
  trees: {
    site: Record<string, string>;
    base: Record<string, string | null>;
    proposal: Record<string, string | null>;
  };
  modules: Record<
    string,
    { base: string | null; site: string | null; proposal: string | null }
  >;
  sources: Record<string, JSONValue>;
};

/** Which tree: where the proposal started, the site, or the proposal. */
export type Side = "base" | "site" | "proposal";

/** A module, as evaluating its tree in the tab gave it. */
export type EvaluatedModule = {
  schema: SerializedSchema;
  /** The content its file's text holds. */
  written: JSONValue;
  /** The errors of the module's Source under this schema. */
  errors: SchemaError[];
};
export type Evaluated = Record<ModuleFilePath, EvaluatedModule>;

/** A side's files: the site's tree, the base's changes over it, the proposal's over that. */
export function sideFiles(
  trees: MergeTrees,
  side: Side,
): Record<string, string> {
  const layers: Record<string, string | null>[] =
    side === "site"
      ? []
      : side === "base"
        ? [trees.trees.base]
        : [trees.trees.base, trees.trees.proposal];
  const files: Record<string, string> = { ...trees.trees.site };
  for (const layer of layers) {
    for (const [path, text] of Object.entries(layer)) {
      if (text === null) delete files[path];
      else files[path] = text;
    }
  }
  return files;
}

/** A side's Source of a module, from content's index; `null` when it has none. */
export function sideSource(
  trees: MergeTrees,
  side: Side,
  moduleFilePath: ModuleFilePath,
): JSONValue | null {
  const sha = trees.modules[moduleFilePath]?.[side] ?? null;
  return sha === null ? null : (trees.sources[sha] ?? null);
}

/**
 * What a schema reports about this content, without the errors the server
 * fixes on its own (those with `fixes`): run on the schema instance that
 * evaluating the module made, so custom rules take part.
 */
export function schemaErrorsOf(
  schema: Schema<SelectorSource>,
  moduleFilePath: ModuleFilePath,
  source: JSONValue | undefined,
): SchemaError[] {
  const res = schema["executeValidate"](
    moduleFilePath as string as SourcePath,
    source,
  );
  if (res === false) return [];
  const errors: SchemaError[] = [];
  for (const [sourcePath, list] of Object.entries(res)) {
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as SourcePath,
    );
    const path = modulePath ? Internal.createPatchPath(modulePath) : [];
    for (const error of list) {
      if (error.fixes && error.fixes.length > 0) continue;
      errors.push({ path, message: error.message });
    }
  }
  return errors;
}
