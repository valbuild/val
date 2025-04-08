import {
  SerializedObjectUnionSchema,
  SerializedSchema,
  SerializedStringUnionSchema,
} from "@valbuild/core";

/**
 * Iterates through all schemas and find if there is 1 or more remote files in them
 */
export function hasRemoteFileSchema(schema: SerializedSchema): boolean {
  if (schema.type === "file" || schema.type === "image") {
    return !!schema.remote;
  } else if (schema.type === "richtext") {
    if (typeof schema.options?.inline?.img === "object") {
      return hasRemoteFileSchema(schema.options.inline.img);
    }
    return false;
  } else if (schema.type === "array" || schema.type === "record") {
    return hasRemoteFileSchema(schema.item);
  } else if (schema.type === "object") {
    for (const key in schema.items) {
      const hasRemoteFile = hasRemoteFileSchema(schema.items[key]);
      if (hasRemoteFile) {
        return true;
      }
    }
    return false;
  } else if (schema.type === "union") {
    const unionStringSchema =
      typeof schema.key === "object" && schema.key.type === "literal"
        ? (schema as SerializedStringUnionSchema)
        : undefined;
    const unionObjectSchema =
      typeof schema.key === "string"
        ? (schema as SerializedObjectUnionSchema)
        : undefined;
    if (unionStringSchema) {
      return false;
    }
    if (unionObjectSchema) {
      for (const key in unionObjectSchema.items) {
        const hasRemoteFile = hasRemoteFileSchema(unionObjectSchema.items[key]);
        if (hasRemoteFile) {
          return true;
        }
      }
    }
    return false;
  } else if (
    schema.type === "boolean" ||
    schema.type === "number" ||
    schema.type === "string" ||
    schema.type === "literal" ||
    schema.type === "date" ||
    schema.type === "keyOf"
  ) {
    return false;
  } else {
    const exhaustiveCheck: never = schema;
    throw new Error(`Unexpected schema: ${JSON.stringify(exhaustiveCheck)}`);
  }
}
