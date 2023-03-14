import { Source } from "../Source";
import { ArraySchema } from "./array";
import { I18nSchema } from "./i18n";
import { ObjectSchema } from "./object";
import type { Schema, SerializedSchema } from "./Schema";
import { StringSchema } from "./string";

export function deserializeSchema(schema: SerializedSchema): Schema<Source> {
  switch (schema.type) {
    case "array":
      return ArraySchema.deserialize(schema);
    case "i18n":
      return I18nSchema.deserialize(schema);
    case "object":
      return ObjectSchema.deserialize(schema);
    case "string":
      return StringSchema.deserialize(schema);
  }
}
