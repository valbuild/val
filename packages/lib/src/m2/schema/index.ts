import { Source } from "../Source";
import { SourcePath } from "../val";
import { SerializedArraySchema, ArraySchema } from "./array";
import { SerializedObjectSchema, ObjectSchema } from "./object";
import { SerializedNumberSchema, NumberSchema } from "./number";
import { SerializedStringSchema, StringSchema } from "./string";
import { SerializedUndefinedSchema, UndefinedSchema } from "./undefined";

export type SerializedSchema = SerializedStringSchema | SerializedObjectSchema;

export abstract class Schema<Src extends Source> {
  abstract validate(src: Src): false | Record<SourcePath, string[]>;
  abstract match(src: Src): boolean; // TODO: false | Record<SourcePath, string[]>;
  abstract optional(): Schema<Src | undefined>;
  protected abstract serialize(): SerializedSchema;
}

export type SchemaSrcOf<T extends Schema<Source>> = T extends Schema<infer Src>
  ? Src
  : never;
