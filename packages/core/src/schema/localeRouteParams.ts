import { SerializedSchema } from ".";
import { isPageRouter, routePatternOf } from "../getSourcePathFromRoute";
import { routeParamsOfPattern } from "../router";
import { resolveSettingsModule } from "../settingsModule";
import { ModuleFilePath } from "../val";

/**
 * The route parameter names that say "this segment is a language".
 *
 * The two that TanStack's and Next's own i18n guides use. Deliberately not a
 * wider guess (`language`, `country`, `region`): a name on this list that is
 * NOT a language has to be given a schema to silence the check, and every name
 * added is another route that has to do that for no reason.
 */
export const LOCALE_ROUTE_PARAM_NAMES: readonly string[] = ["locale", "lang"];

/**
 * Route modules whose URL has a language segment that nothing describes.
 *
 * A router only checks a key's locale when its module says which parameter is
 * the locale — `s.router(router, { locale: urlLocale, … }, item)` — and that has
 * to be written again in every route module. Forgetting it in one is silent:
 * `/xx/blog/hello` validates, the pages are in no language, and nothing reports
 * it. So this reports it: a page router whose route has a `locale` or `lang`
 * parameter WITH NO SCHEMA, in a project that has declared its languages.
 *
 * Any schema at all for the parameter is an answer, including one that is not a
 * locale — `{ lang: s.enum("typescript", "python") }` is how a route whose
 * `$lang` is not a language says so. Only the absence of one is reported.
 *
 * A project-wide rule rather than a router's own validation, for the same
 * reason as {@link resolveSettingsModule} and the view-cycle check beside it:
 * "the project has languages" is in the settings module, which no single
 * module's validation can read. A project that declares none is not translated,
 * and a `[locale]` segment there is the app's own business.
 */
export function untypedLocaleRouteParamErrors(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, unknown>,
): { message: string; path: ModuleFilePath }[] {
  const settingsModule = resolveSettingsModule(schemas).moduleFilePath;
  if (
    settingsModule === null ||
    declaredLocalesOf(sources[settingsModule]).length === 0
  ) {
    return [];
  }
  const errors: { message: string; path: ModuleFilePath }[] = [];
  for (const moduleFilePathS of Object.keys(schemas).sort()) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (
      schema.type !== "record" ||
      schema.router === undefined ||
      !isPageRouter(schema.router)
    ) {
      continue;
    }
    const pattern = routePatternOf(schema.router, moduleFilePath) ?? [];
    for (const { name, optional } of routeParamsOfPattern(pattern)) {
      if (!LOCALE_ROUTE_PARAM_NAMES.includes(name)) {
        continue;
      }
      if (schema.params !== undefined && name in schema.params) {
        continue;
      }
      const segment = optional ? `[[${name}]]` : `[${name}]`;
      errors.push({
        path: moduleFilePath,
        message: `The route of '${moduleFilePath}' has a '${name}' segment (${segment}), but nothing says which of the project's languages it can be, so its pages are not in any language and '/xx/…' validates. Give the parameter a locale schema: s.router(router, { ${name}: urlLocale, … }, item), where urlLocale is an s.enum(…).locales({ … }) or s.locale(). If '${name}' is not a language here, give it a schema of its own instead, e.g. { ${name}: s.enum(…) }.`,
      });
    }
  }
  return errors;
}

/** `locales.available` from the settings module's source, or none. */
function declaredLocalesOf(source: unknown): string[] {
  if (!isRecord(source)) {
    return [];
  }
  const locales = source["locales"];
  if (!isRecord(locales)) {
    return [];
  }
  const available = locales["available"];
  return Array.isArray(available)
    ? available.filter((each): each is string => typeof each === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
