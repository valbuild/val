/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

type ObjectSchemaProps = { [key: string]: Schema<SelectorSource> };
type ObjectSchemaSrcOf<Props extends ObjectSchemaProps> = {
  [key in keyof Props]: SchemaTypeOf<Props[key]>;
};

export class ObjectSchema<Props extends ObjectSchemaProps> extends Schema<
  ObjectSchemaSrcOf<Props>
> {
  constructor(readonly props: Props, readonly isOptional: boolean = false) {
    super();
  }

  validate(
    src: ObjectSchemaSrcOf<Props>
  ): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: ObjectSchemaSrcOf<Props>): boolean {
    if (this.isOptional && (src === null || src === undefined)) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all props

    return typeof src === "object" && !Array.isArray(src);
  }

  optional(): Schema<ObjectSchemaSrcOf<Props> | null> {
    return new ObjectSchema(this.props, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "object",
      schema: Object.fromEntries(
        Object.entries(this.props).map(([key, schema]) => [
          key,
          schema.serialize(),
        ])
      ),
      opt: this.isOptional,
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
