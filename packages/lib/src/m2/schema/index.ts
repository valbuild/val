import { SelectorSource } from "../selector";
import { SourcePath } from "../val";
import { SerializedObjectSchema } from "./object";
import { SerializedStringSchema } from "./string";

export type SerializedSchema = SerializedStringSchema | SerializedObjectSchema;

export abstract class Schema<Src extends SelectorSource> {
  abstract validate(src: Src): false | Record<SourcePath, string[]>;
  abstract match(src: Src): boolean; // TODO: false | Record<SourcePath, string[]>;
  abstract optional(): Schema<Src | undefined>;
  protected abstract serialize(): SerializedSchema;
}

export type SchemaTypeOf<T extends Schema<SelectorSource>> = T extends Schema<
  infer Src
>
  ? Src
  : never;
