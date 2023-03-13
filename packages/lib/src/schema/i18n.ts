import * as lens from "../lens";
import { Source } from "../Source";
import { Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedI18nSchema = {
  type: "i18n";
  schema: SerializedSchema;
};

export class I18nSchema<T extends Schema<Source, unknown>> extends Schema<
  Record<"en_US", lens.InOf<T>>,
  lens.OutOf<T>
> {
  constructor(private readonly schema: T) {
    super();
  }
  validate(input: Record<"en_US", lens.InOf<T>>): false | string[] {
    const errors: string[] = [];
    for (const key in input) {
      const value = input[key as "en_US"];
      const result = this.schema.validate(value);
      if (result) {
        errors.push(...result.map((error) => `[${key}]: ${error}`));
      }
    }
    if (errors.length > 0) {
      return errors;
    }
    return false;
  }

  apply(input: Record<"en_US", lens.InOf<T>>): lens.OutOf<T> {
    return this.schema.apply(input["en_US"]) as lens.OutOf<T>;
  }

  descriptor(): ReturnType<T["descriptor"]> {
    return this.schema.descriptor() as ReturnType<T["descriptor"]>;
  }

  serialize(): SerializedI18nSchema {
    return {
      type: "i18n",
      schema: this.schema.serialize(),
    };
  }

  static deserialize(
    schema: SerializedI18nSchema
  ): I18nSchema<Schema<Source, unknown>> {
    return new I18nSchema(deserializeSchema(schema.schema));
  }
}
export const i18n = <T extends Schema<Source, unknown>>(
  schema: T
): I18nSchema<T> => {
  return new I18nSchema(schema);
};
