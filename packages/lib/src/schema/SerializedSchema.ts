import { ValidTypes } from "../ValidTypes";
import { ArraySchema, SerializedArraySchema } from "./array";
import { ObjectSchema, SerializedObjectSchema } from "./object";
import type { Schema } from "./Schema";
import { SerializedStringSchema, StringSchema } from "./string";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export function deserialize(schema: SerializedSchema): Schema<ValidTypes> {
  switch (schema.type) {
    case "string":
      return StringSchema.deserialize(schema);
    case "object":
      return ObjectSchema.deserialize(schema);
    case "array":
      return ArraySchema.deserialize(schema);
  }
}
