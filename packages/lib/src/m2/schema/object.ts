import { Schema, SchemaSrcOf, SerializedSchema } from ".";
import { Source } from "../Source";
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected validate(src: {
    [key in keyof Props]: SchemaSrcOf<Props[key]>;
  }): false | string[] {
    throw new Error("Method not implemented.");
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const object = <Props extends ObjectSchemaProps>(
  schema: Props
): Schema<{
  [key in keyof Props]: SchemaSrcOf<Props[key]>;
}> => {
  return new ObjectSchema(schema);
};

{
  object({
    foo: string(),
  });
}
