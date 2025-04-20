import {
  SourcePath,
  ModuleFilePath,
  Json,
  SerializedSchema,
  Internal,
  ModulePath,
  JsonObject,
  SerializedObjectSchema,
  SerializedObjectUnionSchema,
  SerializedStringUnionSchema,
} from "@valbuild/core";

/**
 * This defines the logic for when we should stop while moving up the path.
 * It must be in sync with the logic in the rest of UX - we should consider if there's a way to avoid an implicit contract
 */
function isSchemaNavStop(
  schema: SerializedSchema,
  parentSchema: SerializedSchema | null,
): boolean {
  if (parentSchema?.type === "array") {
    if (schema.type === "string") {
      return false;
    }
    return true;
  } else if (parentSchema?.type === "record") {
    return true;
  }
  return false;
}

export function getNavPathFromAll(
  requestedPath: SourcePath | ModuleFilePath,
  allSources: Record<ModuleFilePath, Json>,
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined,
): SourcePath | ModuleFilePath | null {
  if (!schemas) {
    return null;
  }

  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(requestedPath);
  if (!modulePath) {
    return moduleFilePath;
  }

  const source = allSources[moduleFilePath];
  const schema = schemas[moduleFilePath];
  if (!source || !schema) {
    return null;
  }

  const resolutionRes = resolvePath(
    Internal.splitModulePath(modulePath),
    schema,
    source,
  );
  if (resolutionRes.success) {
    // Move upwards in path until we find where to stop:
    for (let i = resolutionRes.allResolved.length - 1; i >= 0; i--) {
      const resolved = resolutionRes.allResolved[i];
      const parent = resolutionRes.allResolved[i - 1];
      if (isSchemaNavStop(resolved.schema, parent?.schema || null)) {
        if (resolved.modulePath === "") {
          return moduleFilePath;
        }
        return Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          resolved.modulePath,
        );
      }
    }
    return moduleFilePath;
  }
  return null;
}

// TODO: This is a bit sloppy. We copied this from resolvePatchPath (if that still exists)
// and bolted on allResolved. We should probably refactor all of the different functions that resolve
// paths to share a common base. This is a bit of a mess right now.
export function resolvePath(
  patchPath: string[],
  schema: SerializedSchema,
  source: Json,
):
  | {
      success: true;
      modulePath: ModulePath;
      source: Json;
      schema: SerializedSchema;
      allResolved: {
        modulePath: ModulePath;
        schema: SerializedSchema;
        source: Json;
      }[];
    }
  | { success: false; error: string } {
  if (patchPath.length === 0) {
    return { success: false, error: "Empty path" };
  }

  let i = -1;
  let current: string = "";
  const addPart = (part: string) => {
    if (current === "") {
      current = part;
    } else {
      current += "." + part;
    }
  };
  let currentSchema: SerializedSchema = schema;
  let currentSource: Json = source;
  const allResolved: {
    modulePath: ModulePath;
    schema: SerializedSchema;
    source: Json;
  }[] = [
    {
      modulePath: current as ModulePath,
      schema: currentSchema,
      source: currentSource,
    },
  ];
  for (const part of patchPath) {
    i++;
    if (part === "") {
      return {
        success: false,
        error: `Empty path part in: '${patchPath.join("/")}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
      };
    }
    if (currentSchema.type === "array") {
      currentSchema = currentSchema.item;
      const numberPart = Number(part);
      if (!Number.isSafeInteger(numberPart)) {
        return {
          success: false,
          error: `Invalid array index in: '${patchPath.join("/")}'. Expected an integer but got '${part}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
      if (typeof currentSource !== "object") {
        return {
          success: false,
          error: `Invalid source type in: '${patchPath.join("/")}'. Expected an object but got '${typeof currentSource}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
      if (currentSource === null) {
        return {
          success: false,
          error: `Invalid source type in: '${patchPath.join("/")}'. Expected an object but got 'null' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
      if (currentSource === undefined) {
        return {
          success: false,
          error: `Invalid source type in: '${patchPath.join("/")}'. Expected an object but got 'undefined' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
      if (!Array.isArray(currentSource)) {
        return {
          success: false,
          error: `Invalid source type in: '${patchPath.join("/")}'. Expected an array but got '${typeof currentSource}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
      if (!currentSource[numberPart]) {
        return {
          success: false,
          error: `Invalid array index in: '${patchPath.join("/")}'. Expected an index less than ${currentSource.length} but got '${numberPart}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
      currentSource = currentSource[numberPart];
      addPart(part);
    } else if (currentSchema.type === "record") {
      currentSchema = currentSchema.item;
      const currentObjectSourceRes = getObjectSourceOrError(
        patchPath,
        part,
        i,
        currentSource,
        "record",
      );
      if (!currentObjectSourceRes.success) {
        return {
          success: false,
          error: currentObjectSourceRes.error,
        };
      }
      currentSource = currentObjectSourceRes.source[part];
      addPart(JSON.stringify(part));
    } else if (currentSchema.type === "object") {
      currentSchema = currentSchema.items[part];
      const currentObjectSourceRes = getObjectSourceOrError(
        patchPath,
        part,
        i,
        currentSource,
        "record",
      );
      if (!currentObjectSourceRes.success) {
        return {
          success: false,
          error: currentObjectSourceRes.error,
        };
      }
      currentSource = currentObjectSourceRes.source[part];
      addPart(JSON.stringify(part));
    } else if (currentSchema.type === "union") {
      const unionStringSchema =
        typeof currentSchema.key === "object" &&
        currentSchema.key.type === "literal"
          ? (currentSchema as SerializedStringUnionSchema)
          : undefined;
      const unionObjectSchema =
        typeof currentSchema.key === "string"
          ? (currentSchema as SerializedObjectUnionSchema)
          : undefined;
      if (unionStringSchema) {
        return {
          success: false,
          error: `Invalid lookup in string union`,
        };
      } else if (unionObjectSchema) {
        const currentObjectSourceRes = getObjectSourceOrError(
          patchPath,
          part,
          i,
          currentSource,
          "union object",
        );
        if (!currentObjectSourceRes.success) {
          return {
            success: false,
            error: currentObjectSourceRes.error,
          };
        }
        const currentObjectSource = currentObjectSourceRes.source;
        let foundSchema: SerializedObjectSchema | undefined;
        for (const item of unionObjectSchema.items) {
          const maybeLiteral = item.items[unionObjectSchema.key];
          if (maybeLiteral.type === "literal") {
            if (
              currentObjectSource[unionObjectSchema.key] === maybeLiteral.value
            ) {
              foundSchema = item;
              break;
            }
          } else {
            return {
              success: false,
              error: `Invalid lookup in union: unknown union type in: '${patchPath.join("/")}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
            };
          }
        }
        if (!foundSchema) {
          return {
            success: false,
            error: `Invalid lookup in union: unknown union type in: '${patchPath.join("/")}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
          };
        }
        currentSchema = foundSchema.items[part];
        currentSource = currentObjectSource[part];
        addPart(JSON.stringify(part));
      } else {
        return {
          success: false,
          error: `Invalid lookup in union: unknown union type in: '${patchPath.join("/")}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
        };
      }
    } else {
      return {
        success: false,
        error: `Cannot construct sub-path in schema of '${currentSchema.type}' in: '${patchPath.join("/")}'. Path was: '${patchPath.join("/")}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")}`,
      };
    }
    allResolved.push({
      modulePath: current as ModulePath,
      schema: currentSchema,
      source: currentSource,
    });
  }
  return {
    success: true,
    modulePath: current as ModulePath,
    schema: currentSchema,
    source: currentSource,
    allResolved,
  };
}

function getObjectSourceOrError(
  patchPath: string[],
  part: string,
  i: number,
  source: Json,
  expectedType: string,
):
  | {
      success: true;
      source: JsonObject;
    }
  | {
      success: false;
      error: string;
    } {
  if (typeof source !== "object") {
    return {
      success: false,
      error: `Invalid source type in: '${patchPath.join("/")}'. Expected an '${expectedType}' but got '${typeof source}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
    };
  }
  if (source === null) {
    return {
      success: false,
      error: `Invalid source type in: '${patchPath.join("/")}'. Expected an '${expectedType}' but got 'null' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
    };
  }
  if (source === undefined) {
    return {
      success: false,
      error: `Invalid source type in: '${patchPath.join("/")}'. Expected an '${expectedType}' but got 'undefined' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
    };
  }
  if (typeof source !== "object") {
    return {
      success: false,
      error: `Invalid source type in: '${patchPath.join("/")}'. Expected an '${expectedType}' but got '${typeof source}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
    };
  }
  if (Array.isArray(source)) {
    return {
      success: false,
      error: `Invalid source type in: '${patchPath.join("/")}'. Expected an '${expectedType}' but got 'array' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
    };
  }
  if (!(part in source)) {
    return {
      success: false,
      error: `Could not find key of source: '${patchPath.join("/")}'. Expected a key in ${Object.keys(source).join(", ")} but got '${part}' at part ${i} (sliced: ${patchPath.slice(0, i + 1).join("/")})`,
    };
  }
  return {
    success: true,
    source: source as JsonObject,
  };
}
