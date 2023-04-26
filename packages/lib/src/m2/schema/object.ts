import { Schema, SchemaSrcOf, SerializedSchema } from ".";
import { Source } from "../selector";
import { string } from "./string";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

type ObjectSchemaProps = { [key: string]: Schema<Source> };

export class ObjectSchema<Props extends ObjectSchemaProps> extends Schema<{
  [key in keyof Props]: SchemaSrcOf<Props[key]>;
}> {
  constructor(readonly props: Props) {
    super();
  }

  protected validate(src: Src): false | string[] {
    throw new Error("Method not implemented.");
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const object = <T extends ObjectSchemaProps>(
  schema: T
): ObjectSchema<T> => {
  return new ObjectSchema(schema);
};

{
  object({
    foo: string(),
  });
}
