import { A, F } from "ts-toolbelt";
import { SelectorSource } from "../selector";
import { RemoteCompatibleSource, RemoteSource } from "../Source";
import { SourcePath } from "../val";
import { array } from "./array";
import { boolean } from "./boolean";
import { i18n } from "./i18n";
import { number } from "./number";
import { object, SerializedObjectSchema } from "./object";
import { oneOf } from "./oneOf";
import { SerializedStringSchema, string } from "./string";
import { union } from "./union";

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
    throw new Error("Method not implemented.");
  }
}

export type SchemaTypeOf<T extends Schema<SelectorSource>> = T extends Schema<
  infer Src
>
  ? Src
  : never; // TODO: SourceError<"Could not determine type of Schema">
