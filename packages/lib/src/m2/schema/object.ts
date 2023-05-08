/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaSrcOf, SerializedSchema } from ".";
import { Source } from "../Source";
import { SourcePath } from "../val";
import { string } from "./string";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

type ObjectSchemaProps = { [key: string]: Schema<Source> };
type ObjectSchemaSrcOf<Props extends ObjectSchemaProps> = {
  [key in keyof Props]: SchemaSrcOf<Props[key]>;
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
    if (this.isOptional && src === undefined) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all props

    return typeof src === "object" && !Array.isArray(src);
  }

  optional(): Schema<ObjectSchemaSrcOf<Props> | undefined> {
    return new ObjectSchema(this.props, true);
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const object = <Props extends ObjectSchemaProps>(
  schema: Props
): Schema<ObjectSchemaSrcOf<Props>> => {
  return new ObjectSchema(schema);
};

{
  object({
    foo: string(),
  });
}
