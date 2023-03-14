import { Source } from "../Source";
import { Schema, SourceOf, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedI18nSchema = {
  type: "i18n";
  schema: SerializedSchema;
};

export class I18nSchema<T extends Schema<Source>> extends Schema<
  Record<"en_US", SourceOf<T>>
> {
  constructor(private readonly schema: T) {
    super();
  }
  validate(input: Record<"en_US", SourceOf<T>>): false | string[] {
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

  descriptor(): {
    type: "i18n";
    desc: ReturnType<T["descriptor"]>;
  } {
    return {
      type: "i18n",
      desc: this.schema.descriptor() as ReturnType<T["descriptor"]>,
    };
  }

  serialize(): SerializedI18nSchema {
    return {
      type: "i18n",
      schema: this.schema.serialize(),
    };
  }

  static deserialize(schema: SerializedI18nSchema): I18nSchema<Schema<Source>> {
    return new I18nSchema(deserializeSchema(schema.schema));
  }
}
export const i18n = <T extends Schema<Source>>(schema: T): I18nSchema<T> => {
  return new I18nSchema(schema);
};
