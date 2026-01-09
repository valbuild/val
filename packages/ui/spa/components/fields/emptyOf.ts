import { SerializedSchema, Json } from "@valbuild/core";
import { format } from "date-fns";

export function emptyOf(schema: SerializedSchema): Json {
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.keys(schema.items).map((key) => [key, emptyOf(schema.items[key])]),
    );
  } else if (schema.type === "array") {
    return [];
  } else if (schema.type === "record") {
    return {};
  } else if (schema.opt) {
    return null;
  } else if (schema.type === "richtext") {
    return [];
  } else if (schema.type === "string") {
    return "";
  } else if (schema.type === "boolean") {
    return false;
  } else if (schema.type === "number") {
    return 0;
  } else if (schema.type === "keyOf") {
    if (schema.values === "string") {
      return ""; // TODO: figure out this: user code might very well fail in this case
    } else {
      return schema.values[0];
    }
  } else if (schema.type === "route") {
    return ""; // Empty string as default route value
  } else if (schema.type === "file" || schema.type === "image") {
    return null; // returning null is the only thing we can do, however, it means that the patches cannot be applied yet since that might fail
  } else if (schema.type === "literal") {
    return schema.value;
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      return emptyOf(schema.items[0]);
    }
    return schema.key.value;
  } else if (schema.type === "date") {
    return format(new Date(), "yyyy-MM-dd");
  }
  const _exhaustiveCheck: never = schema;
  throw Error("Unexpected schema type: " + JSON.stringify(_exhaustiveCheck));
}
