import { SerializedSchema } from "./schema";
import { ModuleFilePath } from "./val";

/**
 * Where a settings module goes unless a project has a reason not to.
 *
 * A convention, not a rule: any module file path at the root of the content
 * tree may hold `s.settings()` — see {@link resolveSettingsModule}.
 */
export const SETTINGS_MODULE_CONVENTION = "/settings.val.ts" as ModuleFilePath;

/**
 * Whether a module file path is at the root of the content tree.
 *
 * `/settings.val.ts` is; `/content/settings.val.ts` is not. The settings module
 * is the project's, not a folder's, and a project-wide setting found three
 * directories down reads as one section's — so the position is part of what it
 * means.
 */
export function isRootModuleFilePath(moduleFilePath: string): boolean {
  return (
    moduleFilePath.startsWith("/") && !moduleFilePath.slice(1).includes("/")
  );
}

export type ResolvedSettingsModule = {
  /**
   * The project's settings module, if it has exactly one valid one.
   *
   * `null` both when there is no settings module and when what there is cannot
   * be used (nested, or ambiguous). A caller that reads settings therefore does
   * not have to consider the broken cases: it gets nothing, and the errors are
   * reported by whoever is in a position to report them.
   */
  moduleFilePath: ModuleFilePath | null;
  /**
   * What is wrong with how settings are declared, ready to print.
   *
   * Empty in the ordinary cases — one settings module, or none. Reported as
   * MODULE errors, each attributed to the file it is about: extraction appends
   * them, which is what puts them in front of the reader in all three places at
   * once — the dev server refuses to serve sources with a module error,
   * `val validate` reports them against the file, and the Studio shows them.
   *
   * A duplicate produces one error per offending module, each naming all of
   * them, so the message is there whichever of the files you happen to open.
   */
  errors: SettingsModuleError[];
};

/**
 * Structurally an `ExtractedModuleError`, declared here rather than imported to
 * keep `extractValModules` -> `settingsModule` a one-way dependency.
 */
export type SettingsModuleError = {
  message: string;
  path: ModuleFilePath;
};

/**
 * Find the project's settings module among all its schemas.
 *
 * One per project, at the root: a settings module in a subdirectory is an
 * error, and so is a second one. Both are reported rather than resolved by
 * picking a winner — a project with two settings modules has a question to
 * answer, and answering it by sort order means the answer changes when a file
 * is renamed.
 */
export function resolveSettingsModule(
  schemas:
    | Record<ModuleFilePath, SerializedSchema>
    | Record<ModuleFilePath, SerializedSchema | undefined>,
): ResolvedSettingsModule {
  const rootModules: ModuleFilePath[] = [];
  const nestedModules: ModuleFilePath[] = [];
  for (const moduleFilePathS of Object.keys(schemas).sort()) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    if (schemas[moduleFilePath]?.type !== "settings") {
      continue;
    }
    if (isRootModuleFilePath(moduleFilePath)) {
      rootModules.push(moduleFilePath);
    } else {
      nestedModules.push(moduleFilePath);
    }
  }
  const errors: SettingsModuleError[] = [];
  for (const moduleFilePath of nestedModules) {
    errors.push({
      path: moduleFilePath,
      message: `Settings must be defined at the root of the content tree, but s.settings() was found in '${moduleFilePath}'. Move it to '${SETTINGS_MODULE_CONVENTION}'.`,
    });
  }
  if (rootModules.length > 1) {
    const listed = rootModules
      .map((moduleFilePath) => `'${moduleFilePath}'`)
      .join(" and ");
    for (const moduleFilePath of rootModules) {
      errors.push({
        path: moduleFilePath,
        message: `A project can only define settings once, but s.settings() was found in ${listed}. Keep one of them.`,
      });
    }
  }
  return {
    moduleFilePath:
      errors.length === 0 && rootModules.length === 1 ? rootModules[0] : null,
    errors,
  };
}
