import { SelectorSource } from "../selector";
import { RemoteCompatibleSource, RemoteSource } from "../source";
import { SourcePath } from "../val";
import { SerializedObjectSchema } from "./object";
import { SerializedStringSchema } from "./string";

export type SerializedSchema = SerializedStringSchema | SerializedObjectSchema;

export abstract class Schema<Src extends SelectorSource> {
  abstract validate(src: Src): false | Record<SourcePath, string[]>;
  abstract match(src: Src): boolean; // TODO: false | Record<SourcePath, string[]>;
  abstract optional(): Schema<Src | null>;
  protected abstract serialize(): SerializedSchema;
  remote(): Src extends RemoteCompatibleSource
    ? Schema<RemoteSource<Src>>
    : never {
    // TODO: Schema<never, "Cannot create remote schema from non-remote source.">
    throw new Error("You need Val Ultra to use .remote()");
  }
}

export type SchemaTypeOf<T extends Schema<SelectorSource>> = T extends Schema<
  infer Src
>
  ? Src
  : never; // TODO: SourceError<"Could not determine type of Schema">
