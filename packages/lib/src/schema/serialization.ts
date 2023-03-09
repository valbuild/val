import { ValidTypes } from "../ValidTypes";
import { ArraySchema } from "./array";
import { ObjectSchema } from "./object";
import { Schema, SerializedSchema } from "./Schema";
import { StringSchema } from "./string";

export function deserializeSchema(
  schema: SerializedSchema
): Schema<ValidTypes> {
  switch (schema.type) {
    case "string":
      return StringSchema.deserialize(schema);
    case "object":
      return ObjectSchema.deserialize(schema);
    case "array":
      return ArraySchema.deserialize(schema);
  }
}
