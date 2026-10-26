import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationError,
  type ValModules,
} from "@valbuild/core";
import { resolveSchemaSourceFixes } from "./resolveSchemaSourceFixes";
import { partitionValidationErrors } from "./validation/partitionValidationErrors";

/**
 * A Val checking a site with ITS OWN rules: the platform's upgrade page
 * (valbuild/home `docs/plans/upgrades-v2.md`, piece E) calls this on the
 * version an upgrade moves to, because only that version knows what it
 * requires of the site's content.
 *
 * The page is home's and runs no Val code of its own. It finds this as
 * `Internal.selfCheck` on the framework package in the site's own vendor
 * layer -- the copy that made the site's schemas, since `val.config.ts`
 * imports `initVal` from it -- and hands it the default export of the
 * site's `val.modules.ts`, bundled. A Val from before this has no
 * `selfCheck`, and the page says validation was not available.
 *
 * The answer is data the page shows and nothing else, so its shape is the
 * contract: {@link SELF_CHECK_VERSION} names it, and an answer the page
 * cannot read counts as a failed check there. Change the shape and the
 * version goes up.
 */
export const SELF_CHECK_VERSION = 1;

/** Content the site's schemas do not allow, or a module that would not load. */
export type SelfCheckError = {
  /** The module, or `null` for an entry of `val.modules.ts` that did not load. */
  moduleFilePath: string | null;
  /** Where in the module, as keys and indices; `[]` for the module itself. */
  path: string[];
  message: string;
};

export type SelfCheckResult = {
  version: typeof SELF_CHECK_VERSION;
  /** The `@valbuild/core` that checked. */
  valVersion: string;
  /** How many modules `val.modules.ts` names. */
  modules: number;
  /** What holds a publish back: the errors the Studio would show. */
  errors: SelfCheckError[];
  /**
   * Errors Val repairs itself when the content is saved (an image's
   * metadata, say), which hold nothing back. Counted, so the page can say so.
   */
  repairedOnSave: number;
};

export type SelfCheckOptions = {
  /**
   * The site's content for a module: what it holds now, with every published
   * edit, rather than what its file's text held when the build was made.
   * `null` or `undefined` checks the file's own content.
   */
  sourceOf?: (moduleFilePath: ModuleFilePath) => Json | null | undefined;
};

export async function selfCheck(
  valModules: ValModules,
  options: SelfCheckOptions = {},
): Promise<SelfCheckResult> {
  const errors: SelfCheckError[] = [];
  const found: Record<SourcePath, ValidationError[]> = {};
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Json> = {};

  for (const [index, entry] of valModules.modules.entries()) {
    let module: unknown;
    try {
      module = (await entry.def()).default;
    } catch (error) {
      errors.push({
        moduleFilePath: null,
        path: [],
        message: `Entry ${index + 1} of val.modules.ts could not be loaded: ${messageOf(error)}`,
      });
      continue;
    }
    if (!Internal.isValModule(module)) {
      errors.push({
        moduleFilePath: null,
        path: [],
        message: `Entry ${index + 1} of val.modules.ts does not export c.define(...) as its default.`,
      });
      continue;
    }
    const path = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    if (path === undefined || schema === undefined) continue;
    const moduleFilePath = path as string as ModuleFilePath;
    let source: Source;
    try {
      source =
        options.sourceOf?.(moduleFilePath) ??
        (await Internal.resolveJsonValues(Internal.getSource(module)));
    } catch (error) {
      errors.push({
        moduleFilePath,
        path: [],
        message: `Its content could not be read: ${messageOf(error)}`,
      });
      continue;
    }
    schemas[moduleFilePath] = schema["executeSerialize"]();
    sources[moduleFilePath] = source;
    const result = schema["executeValidate"](path, source);
    if (result === false) continue;
    for (const [sourcePath, list] of Object.entries(result)) {
      (found[sourcePath as SourcePath] ??= []).push(...list);
    }
  }

  // The markers only the whole project can answer (a keyOf's keys, a route,
  // a gallery's entries) are answered here, as a publish answers them, and
  // what Val repairs on save is left out: the same gate the Studio applies.
  const { surfaced, skipped } = partitionValidationErrors(
    resolveSchemaSourceFixes(found, { schemas, sources }),
  );
  for (const [sourcePath, list] of Object.entries(surfaced)) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
    const path = modulePath ? Internal.createPatchPath(modulePath) : [];
    for (const error of list) {
      errors.push({ moduleFilePath, path, message: error.message });
    }
  }

  return {
    version: SELF_CHECK_VERSION,
    valVersion: Internal.VERSION.core,
    modules: valModules.modules.length,
    errors,
    repairedOnSave: Object.values(skipped).reduce(
      (count, list) => count + list.length,
      0,
    ),
  };
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
