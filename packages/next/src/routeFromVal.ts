import { Json, ModuleFilePath, Internal, RecordSchema } from "@valbuild/core";
import {
  getNextAppRouterSourceFolder,
  getPatternFromModuleFilePath,
  parseRoutePattern,
  RoutePattern,
} from "@valbuild/shared/client";

/**
 * True when the module's schema is a `.jsonValues()` record/router — i.e. each
 * entry value is a lazily-loaded `c.json(() => import(...))` marker. Used by the
 * route helpers to load ONLY the matched entry instead of the whole record.
 */
export function isJsonValuesRecordSchema(schema: unknown): boolean {
  return (
    schema instanceof RecordSchema &&
    schema["executeSerialize"]().jsonValues === true
  );
}

/**
 * A whole `.jsonValues()` record, as `useVal` and `fetchVal` read it: with
 * every entry's content. In the record's own source each entry is a lazy
 * `c.json(() => import(...))` marker, so a reader that encodes that source
 * renders every entry empty. (`useValKey` and `fetchValKey` read one entry,
 * and load only that one.)
 *
 * `sourcesOf(modulePath)` are what the reader has before the bundle, the first
 * that has the record winning: a draft view, then a snapshot (a proposal's saves, or the
 * content version the site serves). An entry that is still a marker there is
 * taken from a later source that has its content; the rest are named in
 * `load`, for the reader to load from the bundle by key and hand to
 * {@link fillJsonValuesRecord}.
 *
 * `null` when the selector is not a `.jsonValues()` module, or its record is
 * not an object (a nullable record that is null): there is nothing to fill.
 */
export function jsonValuesRecordToFill(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selector: any,
  sourcesOf: (modulePath: ModuleFilePath) => (Json | undefined)[],
): {
  modulePath: ModuleFilePath;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module: any;
  record: Record<string, unknown>;
  load: string[];
} | null {
  // Untyped, as `getJsonEntryStegaRoot`'s selector is: a module or a view of
  // one, whichever source type it was defined with.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const module: any = Internal.resolveViewedModule(selector);
  if (!module || !isJsonValuesRecordSchema(Internal.getSchema(module))) {
    return null;
  }
  const modulePath = Internal.getValPath(module) as unknown as
    | ModuleFilePath
    | undefined;
  if (!modulePath) {
    return null;
  }
  const sources = sourcesOf(modulePath);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const chosen = sources.find((source) => source !== undefined);
  const base: unknown =
    chosen !== undefined ? chosen : Internal.getSource(module);
  if (!isRecord(base)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  const load: string[] = [];
  for (const [key, entry] of Object.entries(base)) {
    if (!Internal.isJson(entry)) {
      record[key] = entry;
      continue;
    }
    const later = sources
      .slice(sources.indexOf(chosen) + 1)
      .map((source) =>
        isRecord(source) && Object.prototype.hasOwnProperty.call(source, key)
          ? source[key]
          : undefined,
      )
      .find((content) => content !== undefined && !Internal.isJson(content));
    if (later !== undefined) {
      record[key] = later;
    } else {
      // Left as the marker until it is loaded: see `fillJsonValuesRecord`.
      record[key] = entry;
      load.push(key);
    }
  }
  return { modulePath, module, record, load };
}

/**
 * The record from {@link jsonValuesRecordToFill}, with the entries it named in
 * `load` put in: `loaded[key]`, as the bundle's import of that entry gave it.
 * An entry the bundle has no import for keeps its marker.
 */
export function fillJsonValuesRecord(
  record: Record<string, unknown>,
  loaded: Record<string, unknown>,
): Record<string, unknown> {
  const filled: Record<string, unknown> = { ...record };
  for (const [key, content] of Object.entries(loaded)) {
    if (content !== undefined) {
      filled[key] = content;
    }
  }
  return filled;
}

/**
 * The bundle's import of one `.jsonValues()` entry, started: `undefined` when
 * the module's own source has no marker for `key` to import from.
 */
export function bundledJsonEntryImport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module: any,
  key: string,
): (() => Promise<{ default: unknown }>) | undefined {
  const source = module && Internal.getSource(module);
  const marker =
    typeof source === "object" && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)[key]
      : undefined;
  if (!Internal.isJson(marker)) {
    return undefined;
  }
  return Internal.getJsonImport(marker) ?? undefined;
}

/**
 * Builds the `stegaEncode` `root` seed for a single `.jsonValues()` entry, so its
 * strings get edit tags. Without a seed, `stegaEncode` on raw entry content is an
 * identity transform (the content carries no selector path/schema).
 *
 * Yields e.g. `/app/support/[slug]/page.val.ts?p="/support/faq"`, so a `title`
 * field is tagged `…?p="/support/faq"."title"` — the shape the Studio's
 * `findUnloadedJsonEntryKey` walks, so click-to-edit + lazy load line up.
 */
export function getJsonEntryStegaRoot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selector: any,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { path: any; schema: any } | undefined {
  const modulePath = selector && Internal.getValPath(selector);
  if (!modulePath) {
    return undefined;
  }
  const schema = selector && Internal.getSchema(selector);
  if (!(schema instanceof RecordSchema)) {
    return undefined;
  }
  const path = Internal.createValPathOfItem(modulePath, key);
  if (!path) {
    return undefined;
  }
  return { path, schema: schema["executeSerialize"]().item };
}

export function getValRouteUrlFromVal(
  resolvedParams: Record<string, string | string[]> | unknown,
  methodName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  path: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  val: any,
) {
  if (!path) {
    Internal.log.error(
      `${methodName} can only be used with a Val module (details: no Val path found).`,
    );
    return null;
  }
  if (val === null) {
    return null;
  }
  if (typeof val !== "object") {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: expected type object, found ${typeof val} instead).`,
    );
    return null;
  }
  if (Array.isArray(val)) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: expected type object, found array instead).`,
    );
    return null;
  }
  if (!schema) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: no schema found).`,
    );
    return null;
  }
  if (!(schema instanceof RecordSchema)) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: schema is not a record).`,
    );
  } else if (!schema["currentRouter"]) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: router is not set).`,
    );
  } else if (
    schema["currentRouter"].getRouterId() !==
      Internal.nextAppRouter.getRouterId() &&
    schema["currentRouter"].getRouterId() !==
      Internal.externalPageRouter.getRouterId()
  ) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: router is not the Next.js App Router or External URL Page Router).`,
    );
    return null;
  }
  if (typeof resolvedParams !== "object") {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: params is not an object).`,
    );
    return null;
  }
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (
    !(
      moduleFilePath.endsWith("page.val.ts") ||
      moduleFilePath.endsWith("page.val.js")
    )
  ) {
    Internal.log.error(
      `${methodName} is used with a Val module that does not have a page.val.ts or page.val.js file. Make sure the Val module is in the same directory as your page.tsx or page.js file.`,
    );
    return null;
  }
  const srcFolder = getNextAppRouterSourceFolder(
    moduleFilePath as ModuleFilePath,
  );
  if (!srcFolder) {
    Internal.log.error(
      `${methodName} was used with a Val module that is not in the /app or /src/app folder`,
    );
    return null;
  }
  const pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
  const parsedPattern = parseRoutePattern(pattern);
  const missingPatterns: RoutePattern[] = [];
  const fullPathParts: string[] = [];
  const missingParamKeys =
    typeof resolvedParams === "object" &&
    resolvedParams !== null &&
    !Array.isArray(resolvedParams)
      ? { ...resolvedParams }
      : {};
  for (const part of parsedPattern ?? []) {
    if (part.type === "literal") {
      fullPathParts.push(part.name);
    } else if (part.type === "array-param" || part.type === "string-param") {
      const key = part.paramName;
      const value = resolvedParams?.[key as keyof typeof resolvedParams] as
        | string
        | string[]
        | undefined;
      if (
        part.type === "string-param" &&
        part.optional &&
        (value === undefined || value === null)
      ) {
        // An optional segment the URL left out (`{-$locale}`): it contributes
        // nothing to the key, so `/about` is the key for `{ locale: undefined }`.
        delete missingParamKeys[key as keyof typeof missingParamKeys];
      } else if (typeof value !== "string" && !Array.isArray(value)) {
        missingPatterns.push(part);
      } else if (Array.isArray(value)) {
        if (missingParamKeys?.[key as keyof typeof missingParamKeys]) {
          delete missingParamKeys[key as keyof typeof missingParamKeys];
        }
        fullPathParts.push(value.join("/"));
      } else {
        if (missingParamKeys?.[key as keyof typeof missingParamKeys]) {
          delete missingParamKeys[key as keyof typeof missingParamKeys];
        }
        fullPathParts.push(value);
      }
    }
  }
  const lastPattern = missingPatterns?.[missingPatterns.length - 1];
  const isLastOptional =
    lastPattern && lastPattern.type === "array-param" && lastPattern.optional;
  if (isLastOptional) {
    // We **think** that if the last pattern is optional we might still want to match
    // An example: /some-path/[[...test]]
    // Or even: /[[...path]]
    // We believe there's no other legal ways to have optional patterns? Right?
    missingPatterns.pop();
  }

  if (missingPatterns.length > 0) {
    const errorMessageParams = missingPatterns.map((part) => {
      if (part.type === "literal") {
        return part.name;
      } else if (part.type === "string-param") {
        if (part.optional) {
          return `[[${part.paramName}]]`;
        }
        return `[${part.paramName}]`;
      } else if (part.type === "array-param") {
        if (part.optional) {
          return `[[...${part.paramName}]]`;
        }
        return `[...${part.paramName}]`;
      }
    });
    Internal.log.error(
      `${methodName} could not find route since parameters: ${errorMessageParams.join(", ")} where not provided. Make sure the Val module is in the same directory as your page.tsx or page.js file and that the Val module filename is called page.val.ts or page.val.js.`,
    );
    return null;
  }
  if (Object.keys(missingParamKeys).length > 0) {
    Internal.log.error(
      `${methodName} could not find route since parameters: ${Object.keys(missingParamKeys).join(", ")} where not found in the path of: ${moduleFilePath}. Make sure  ${moduleFilePath} in the same directory as your page.tsx or page.js file.`,
    );
    // We do not return null here since we found a route that matches the path
    // though chances are that there's something wrong in the way ${methodName} is used
  }
  const fullPath = fullPathParts.join("/");
  return `/${fullPath}`;
}

export function initValRouteFromVal(
  resolvedParams: Record<string, string | string[]> | unknown,
  methodName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  path: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  val: any,
) {
  const url = getValRouteUrlFromVal(
    resolvedParams,
    methodName,
    path,
    schema,
    val,
  );
  if (!url) {
    return null;
  }
  const actualRoute = val[url];
  if (!actualRoute) {
    return null;
  }
  return actualRoute;
}
