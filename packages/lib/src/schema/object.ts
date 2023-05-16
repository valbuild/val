/* eslint-disable @typescript-eslint/no-unused-vars */
import { A } from "ts-toolbelt";
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { Selector, SelectorSource } from "../selector";
import { Source } from "../source";
import { SourcePath } from "../val";
import { string } from "./string";

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
    throw new Error("Method not implemented.");
  }
}

export const object = <Props extends ObjectSchemaProps>(
  schema: Props
): Schema<A.Compute<ObjectSchemaSrcOf<Props>>> => {
  return new ObjectSchema(schema) as unknown as Schema<
    A.Compute<ObjectSchemaSrcOf<Props>>
  >;
};
