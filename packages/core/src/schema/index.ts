import { Json } from "../Json";
import { SelectorSource } from "../selector";
import { RemoteCompatibleSource, RemoteSource } from "../source/remote";
import { SourcePath } from "../val";
import { SerializedArraySchema } from "./array";
import { SerializedBooleanSchema } from "./boolean";
import { SerializedI18nSchema } from "./i18n";
import { SerializedImageSchema } from "./image";
import { SerializedLiteralSchema } from "./literal";
import { SerializedNumberSchema } from "./number";
import { SerializedObjectSchema } from "./object";
import { SerializedOneOfSchema } from "./oneOf";
import { SerializedRichTextSchema } from "./richtext";
import { SerializedStringSchema } from "./string";
import { SerializedUnionSchema } from "./union";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedLiteralSchema
  | SerializedBooleanSchema
  | SerializedNumberSchema
  | SerializedObjectSchema
  | SerializedOneOfSchema
  | SerializedArraySchema
  | SerializedUnionSchema
  | SerializedRichTextSchema
  | SerializedImageSchema
  | SerializedI18nSchema;

export abstract class Schema<Src extends SelectorSource> {
  abstract validate(path: SourcePath, src: Src): ValidationErrors;
  abstract assert(src: Src): boolean; // TODO: false | Record<SourcePath, string[]>;
  abstract optional(): Schema<Src | null>;
  abstract serialize(): SerializedSchema;
  remote(): Src extends RemoteCompatibleSource
    ? Schema<RemoteSource<Src>>
    : never {
    // TODO: Schema<never, "Cannot create remote schema from non-remote source.">
    throw new Error("You need Val Ultra to use .remote()");
  }

  /** MUTATES! since internal and perf sensitive */
  protected appendValidationError(
    current: ValidationErrors,
    path: SourcePath,
    message: string,
    value?: unknown
  ): ValidationErrors {
    if (current) {
      if (current[path]) {
        current[path].push({ message, value });
      } else {
        current[path] = [{ message, value }];
      }
      return current;
    } else {
      return { [path]: [{ message, value }] } as ValidationErrors;
    }
  }
}

export type SchemaTypeOf<T extends Schema<SelectorSource>> = T extends Schema<
  infer Src
>
  ? Src
  : never; // TODO: SourceError<"Could not determine type of Schema">
