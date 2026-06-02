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

const textEncoder = new TextEncoder();

function hash(input: string | object): string {
  if (typeof input === "object") {
    return hashObject(input);
  }
  return getSHA256Hash(textEncoder.encode(input));
}

function hashObject(obj: object): string {
  const collector: string[] = [];
  collectObjectRecursive(obj, collector);
  return getSHA256Hash(textEncoder.encode(collector.join("")));
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
  const addModuleError = (
    message: string,
    index: number,
    path?: SourcePath,
  ) => {
    moduleErrors[index] = {
      message,
      path: path as string as ModuleFilePath,
    };
  };
  const sources: Record<ModuleFilePath, Source> = {};
  const schemas: Record<ModuleFilePath, Schema<SelectorSource>> = {};
  const serializedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
  const configSha = hash(JSON.stringify(valModules.config));
  let sourcesSha = "";
  let baseSha = configSha;
  let schemaSha = configSha;
  for (let moduleIdx = 0; moduleIdx < valModules.modules.length; moduleIdx++) {
    const module = valModules.modules[moduleIdx];
    if (!module.def) {
      addModuleError("val.modules is missing 'def' property", moduleIdx);
      continue;
    }
    if (typeof module.def !== "function") {
      addModuleError("val.modules 'def' property is not a function", moduleIdx);
      continue;
    }
    await module.def().then((value) => {
      if (!value) {
        addModuleError(`val.modules 'def' did not return a value`, moduleIdx);
        return;
      }
      if (!value.default) {
        addModuleError(
          `val.modules 'def' did not return a default export`,
          moduleIdx,
        );
        return;
      }

      const path = getValPath(value.default);
      if (path === undefined) {
        addModuleError(`path is undefined`, moduleIdx);
        return;
      }
      const schema = getSchema(value.default);
      if (schema === undefined) {
        addModuleError(
          `schema in path '${path}' is undefined`,
          moduleIdx,
          path,
        );
        return;
      }
      // Avoid `schema instanceof Schema` — the editor SPA and the host
      // Next.js bundle each ship their own copy of @valbuild/core, so the
      // `Schema` class identity differs between them and the instanceof
      // check would fail for cross-bundle modules. The executeSerialize
      // check below is the actual contract we depend on.
      if (typeof schema["executeSerialize"] !== "function") {
        addModuleError(
          `schema.serialize in path '${path}' is not a function`,
          moduleIdx,
          path,
        );
        return;
      }
      const source = getSource(value.default);
      if (source === undefined) {
        addModuleError(`source in ${path} is undefined`, moduleIdx, path);
        return;
      }
      let serializedSchema: SerializedSchema;
      try {
        serializedSchema = schema["executeSerialize"]();
      } catch (e) {
        const message = e instanceof Error ? e.message : JSON.stringify(e);
        addModuleError(
          `Could not serialize module: '${path}'. Error: ${message}`,
          moduleIdx,
          path,
        );
        return;
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
      schemaSha = hash(schemaSha + JSON.stringify(serializedSchema));
    });
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
