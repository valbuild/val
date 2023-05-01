import { Source } from "../Source";
import { SerializedObjectSchema } from "./object";
import { SerializedStringSchema } from "./string";

export type SerializedSchema = SerializedStringSchema | SerializedObjectSchema;

export abstract class Schema<Src extends Source> {
  protected abstract validate(src: Src): false | string[];
  protected abstract serialize(): SerializedSchema;
}

export type SchemaSrcOf<T extends Schema<Source>> = T extends Schema<infer Src>
  ? Src
  : never;
