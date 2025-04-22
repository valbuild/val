import {
  SerializedSchema,
  Json,
  ModulePath,
  JsonObject,
  SerializedObjectSchema,
  SerializedObjectUnionSchema,
  SerializedStringUnionSchema,
} from "@valbuild/core";

export function resolvePatchPath(
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
    } else if (
      currentSchema.type === "image" ||
      currentSchema.type === "file"
    ) {
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
