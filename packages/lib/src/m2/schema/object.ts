/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaSrcOf, SerializedSchema } from ".";
import { Source } from "../Source";
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
  constructor(readonly props: Props) {
    super();
  }

  protected validate(src: ObjectSchemaSrcOf<Props>): false | string[] {
    throw new Error("Method not implemented.");
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
