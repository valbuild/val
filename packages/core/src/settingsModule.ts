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
   * Empty in the ordinary cases — one settings module, or none. The three
   * places that enforce this each do something different with these (the module
   * loader throws, `val validate` reports, the Studio shows them), so the
   * messages are written to read the same in all three.
   */
  errors: string[];
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
  const errors: string[] = [];
  for (const moduleFilePath of nestedModules) {
    errors.push(
      `Settings must be defined at the root of the content tree, but was found in '${moduleFilePath}'. Move it to '${SETTINGS_MODULE_CONVENTION}'.`,
    );
  }
  if (rootModules.length > 1) {
    errors.push(
      `A project can only define settings once, but s.settings() was found in ${rootModules
        .map((moduleFilePath) => `'${moduleFilePath}'`)
        .join(" and ")}. Keep one of them.`,
    );
  }
  return {
    moduleFilePath:
      errors.length === 0 && rootModules.length === 1 ? rootModules[0] : null,
    errors,
  };
}
