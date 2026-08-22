import { getSHA256Hash } from "./getSha256";
import { ValModules } from "./modules";
import type { Schema, SerializedSchema } from "./schema";
import { getSchema, SelectorSource } from "./selector";
import { Source } from "./source";
import { getValPath, ModuleFilePath, SourcePath } from "./val";
import { getSource } from "./module";

export type ExtractedModuleError = {
  message: string;
  path?: ModuleFilePath;
};

export type ExtractedValModules = {
  sources: Record<ModuleFilePath, Source>;
  schemas: Record<ModuleFilePath, Schema<SelectorSource>>;
  serializedSchemas: Record<ModuleFilePath, SerializedSchema>;
  baseSha: string;
  schemaSha: string;
  sourcesSha: string;
  configSha: string;
  moduleErrors: ExtractedModuleError[];
};

// Lazily constructed: this module is also evaluated inside the QuickJS
// sandbox (when user val modules import @valbuild/core), and that sandbox
// has no `TextEncoder` global. `hash()` is never called from inside the
// sandbox, so deferring construction avoids a ReferenceError at import time.
let textEncoder: TextEncoder | undefined;
function getTextEncoder(): TextEncoder {
  if (!textEncoder) {
    textEncoder = new TextEncoder();
  }
  return textEncoder;
}

function errorMessage(e: unknown): string {
  // NOT `e instanceof Error`. Val modules are evaluated inside a `node:vm`
  // context, so an error thrown from inside the sandbox is built from THAT
  // realm's Error constructor and fails the instanceof check - and
  // JSON.stringify flattens it to "{}", throwing away the only useful part.
  // Duck-type the message instead (the same reason the schema check below
  // avoids `instanceof Schema`).
  if (typeof e === "object" && e !== null && "message" in e) {
    const { message } = e;
    if (typeof message === "string") {
      return message;
    }
  }
  if (typeof e === "string") {
    return e;
  }
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}
function hash(input: string | object): string {
  if (typeof input === "object") {
    return hashObject(input);
  }
  return getSHA256Hash(getTextEncoder().encode(input));
}

function hashObject(obj: object): string {
  const collector: string[] = [];
  collectObjectRecursive(obj, collector);
  return getSHA256Hash(getTextEncoder().encode(collector.join("")));
}

function collectObjectRecursive(
  item: object | string | number,
  collector: string[],
): void {
  if (typeof item === "string") {
    collector.push(`"`, item, `"`);
    return;
  } else if (typeof item === "number") {
    collector.push(item.toString());
    return;
  } else if (typeof item === "object") {
    if (Array.isArray(item)) {
      collector.push("[");
      for (let i = 0; i < item.length; i++) {
        collectObjectRecursive(item[i], collector);
        if (i !== item.length - 1) collector.push(",");
      }
      collector.push("]");
    } else {
      collector.push("{");
      const keys = Object.keys(item).sort();
      keys.forEach((key, i) => {
        collector.push(`"${key}":`);
        collectObjectRecursive(
          (item as Record<string, string | number | object>)[key],
          collector,
        );
        if (i !== keys.length - 1) collector.push(",");
      });
      collector.push("}");
    }
    return;
  } else {
    console.warn(
      "Unknown type encountered when hashing object",
      typeof item,
      item,
    );
  }
}

/**
 * Extracts schemas and sources from a ValModules registry and computes the
 * deterministic SHAs that the server and client both use to detect changes.
 *
 * Used by ValOps on the server and by ValSyncEngine on the client so the
 * hash algorithm has a single source of truth.
 */
export async function extractValModules(
  valModules: ValModules,
): Promise<ExtractedValModules> {
  const moduleErrors: ExtractedModuleError[] = [];
  // NOTE: push (not index assignment) - a sparse array makes consumers that
  // use Array.prototype.find (which visits holes) crash on undefined entries.
  const addModuleError = (message: string, path?: SourcePath) => {
    moduleErrors.push({
      message,
      path: path as string as ModuleFilePath,
    });
  };
  const sources: Record<ModuleFilePath, Source> = {};
  const schemas: Record<ModuleFilePath, Schema<SelectorSource>> = {};
  const serializedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
  const configSha = hash(JSON.stringify(valModules.config));
  let sourcesSha = "";
  let baseSha = configSha;
  // NOTE: schemaSha is deliberately NOT seeded with configSha. It is compared
  // across bundles (the server extracts from the Node bundle, the editor SPA
  // from the browser bundle) to detect that a new version has been deployed.
  // The config contains values that are not part of the schema and that differ
  // between those two bundles - most notably the documented
  // `gitCommit: process.env.VERCEL_GIT_COMMIT_SHA` / `gitBranch`, which are
  // server-only env vars and therefore `undefined` in the browser. Seeding with
  // them made the two sides disagree on every production load.
  let schemaSha = "";
  for (let moduleIdx = 0; moduleIdx < valModules.modules.length; moduleIdx++) {
    const module = valModules.modules[moduleIdx];
    // NOTE: `at index N` refers to the module's position in the val.modules
    // array, which is all we can name when the module never loaded.
    const at = `at index ${moduleIdx}`;
    if (!module.def) {
      addModuleError(`val.modules ${at} is missing 'def' property`);
      continue;
    }
    if (typeof module.def !== "function") {
      addModuleError(`val.modules ${at} 'def' property is not a function`);
      continue;
    }
    let value: Awaited<ReturnType<typeof module.def>>;
    try {
      value = await module.def();
    } catch (e) {
      // A module that throws while importing (a syntax error, a throwing
      // top-level statement, a missing file) has to be reported like any other
      // module error. Letting it reject aborts the whole extraction, which on
      // the server means ValOps.initSources rejects and /stat, /schema and
      // /sources/~ all fail opaquely instead of naming the broken module.
      addModuleError(
        `val.modules 'def' ${at} could not be loaded. Error: ${errorMessage(e)}`,
      );
      continue;
    }
    if (!value) {
      addModuleError(`val.modules 'def' ${at} did not return a value`);
      continue;
    }
    if (!value.default) {
      addModuleError(`val.modules 'def' ${at} did not return a default export`);
      continue;
    }

    const path = getValPath(value.default);
    if (path === undefined) {
      addModuleError(`path is undefined for val.modules 'def' ${at}`);
      continue;
    }
    const schema = getSchema(value.default);
    if (schema === undefined) {
      addModuleError(`schema in path '${path}' is undefined`, path);
      continue;
    }
    // Avoid `schema instanceof Schema` — the editor SPA and the host
    // Next.js bundle each ship their own copy of @valbuild/core, so the
    // `Schema` class identity differs between them and the instanceof
    // check would fail for cross-bundle modules. The executeSerialize
    // check below is the actual contract we depend on.
    if (typeof schema["executeSerialize"] !== "function") {
      addModuleError(
        `schema.serialize in path '${path}' is not a function`,
        path,
      );
      continue;
    }
    const source = getSource(value.default);
    if (source === undefined) {
      addModuleError(`source in ${path} is undefined`, path);
      continue;
    }
    let serializedSchema: SerializedSchema;
    try {
      serializedSchema = schema["executeSerialize"]();
    } catch (e) {
      addModuleError(
        `Could not serialize module: '${path}'. Error: ${errorMessage(e)}`,
        path,
      );
      continue;
    }
    const pathM = path as string as ModuleFilePath;
    sources[pathM] = source;
    schemas[pathM] = schema;
    serializedSchemas[pathM] = serializedSchema;
    sourcesSha = hash(sourcesSha + JSON.stringify({ path, source }));
    baseSha = hash(
      baseSha +
        JSON.stringify({
          path,
          schema: serializedSchema,
          source,
          modulesErrors: moduleErrors,
        }),
    );
    // The PATH is part of the schema set, not just the schema: renaming a
    // module while leaving its schema byte-identical still changes which paths
    // exist, and an open client keyed its schema cache by the old path. Hashing
    // the schema alone left this SHA unchanged, so with no commitSha to fall
    // back on the client never refetched /schema.
    schemaSha = hash(
      schemaSha + JSON.stringify({ path, schema: serializedSchema }),
    );
  }
  return {
    sources,
    schemas,
    serializedSchemas,
    baseSha,
    schemaSha,
    sourcesSha,
    configSha,
    moduleErrors,
  };
}
