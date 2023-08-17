/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { ValidationError } from "./validation/ValidationError";

export type SerializedObjectSchema = {
  type: "object";
  items: Record<string, SerializedSchema>;
  opt: boolean;
};

type ObjectSchemaProps = { [key: string]: Schema<SelectorSource> };
type ObjectSchemaSrcOf<Props extends ObjectSchemaProps> = {
  [key in keyof Props]: SchemaTypeOf<Props[key]>;
};

export class ObjectSchema<Props extends ObjectSchemaProps> extends Schema<
  ObjectSchemaSrcOf<Props>
> {
  constructor(readonly items: Props, readonly opt: boolean = false) {
    super();
  }

  validate(src: ObjectSchemaSrcOf<Props>): ValidationError {
    throw new Error("Method not implemented.");
  }

  match(src: ObjectSchemaSrcOf<Props>): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all props

    return typeof src === "object" && !Array.isArray(src);
  }

  optional(): Schema<ObjectSchemaSrcOf<Props> | null> {
    return new ObjectSchema(this.items, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "object",
      items: Object.fromEntries(
        Object.entries(this.items).map(([key, schema]) => [
          key,
          schema.serialize(),
        ])
      ),
      opt: this.opt,
    };
  }
}

export const object = <Props extends ObjectSchemaProps>(
  schema: Props
): Schema<{
  [key in keyof Props]: SchemaTypeOf<Props[key]>;
}> => {
  return new ObjectSchema(schema);
};
