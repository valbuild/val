import { SerializedSchema } from "@valbuild/core";

export function findRequiredRemoteFiles(schema: SerializedSchema) {
  if (schema.type === "file") {
    return !!schema.remote;
  } else if (schema.type === "image") {
    return !!schema.remote;
  } else if (schema.type === "richtext") {
    return !!(
      typeof schema.options?.inline?.img !== "boolean" &&
      schema.options?.inline?.img?.remote
    );
  } else if (schema.type === "array") {
    return findRequiredRemoteFiles(schema.item);
  } else if (schema.type === "record") {
    return findRequiredRemoteFiles(schema.item);
  } else if (schema.type === "union") {
    for (const item of schema.items) {
      if (findRequiredRemoteFiles(item)) {
        return true;
      }
    }
    return false;
  } else if (schema.type === "object") {
    for (const key in schema.items) {
      if (findRequiredRemoteFiles(schema.items[key])) {
        return true;
      }
    }
    return false;
  } else if (
    schema.type === "boolean" ||
    schema.type === "number" ||
    schema.type === "string" ||
    schema.type === "date" ||
    schema.type === "keyOf" ||
    schema.type === "route" ||
    schema.type === "literal"
  ) {
    return false;
  } else {
    const exhaustiveCheck: never = schema;
    console.error(
      `Val: requiresRemoteFiles: unexpected schema type ${
        typeof exhaustiveCheck === "object" &&
        "type" in exhaustiveCheck &&
        (exhaustiveCheck as { type?: string }).type
      }`,
      schema,
    );
    return null;
  }
}
