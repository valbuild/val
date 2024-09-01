// import { RemoteCompatibleSource, RemoteSource } from "../source/remote";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";
import { SerializedArraySchema } from "./array";
import { SerializedBooleanSchema } from "./boolean";
import { SerializedFileSchema } from "./file";
import { SerializedImageSchema } from "./image";
import { SerializedKeyOfSchema } from "./keyOf";
import { SerializedLiteralSchema } from "./literal";
import { SerializedNumberSchema } from "./number";
import { SerializedObjectSchema } from "./object";
import { SerializedRecordSchema } from "./record";
import { SerializedRichTextSchema } from "./richtext";
import { SerializedStringSchema } from "./string";
import { SerializedUnionSchema } from "./union";
import { SerializedDateSchema } from "./date";
import { ValidationErrors } from "./validation/ValidationError";
// import { SerializedI18nSchema } from "./future/i18n";
// import { SerializedOneOfSchema } from "./future/oneOf";

export type SerializedSchema =
  // | SerializedOneOfSchema
  // | SerializedI18nSchema
  | SerializedStringSchema
  | SerializedLiteralSchema
  | SerializedBooleanSchema
  | SerializedNumberSchema
  | SerializedObjectSchema
  | SerializedArraySchema
  | SerializedUnionSchema
  | SerializedRichTextSchema
  | SerializedRecordSchema
  | SerializedKeyOfSchema
  | SerializedFileSchema
  | SerializedDateSchema
  | SerializedImageSchema;

export type SchemaAssertResult<T> =
  | { data: T; success: true }
  | { success: false; errors: ValidationErrors };
export abstract class Schema<Src extends SelectorSource> {
  /** Validate the value of source content */
  abstract validate(path: SourcePath, src: Src): ValidationErrors;
  /**
   * Check if the **root** **type** of source is correct.
   *
   * The difference between assert and validate is:
   * - assert verifies that the root **type** of the source is correct (it does not recurse down). Therefore, assert can be used as a runtime type check.
   * - validate checks the **value** of the source in addition to the type. It recurses down the source.
   *
   * For example assert fails for a StringSchema if the source is not a string,
   * it will not fail if the length is not correct.
   * Validate will check the length and all other constraints.
   *
   * Assert is useful if you have a generic schema and need to make sure the root type is valid.
   * When using assert, you must assert recursively if you want to verify the entire source.
   * For example, if you have an object schema, you must assert each key / value pair manually.
   */
  abstract assert(path: SourcePath, src: Src): SchemaAssertResult<Src>;
  abstract nullable(): Schema<Src | null>;
  abstract serialize(): SerializedSchema;
  // remote(): Src extends RemoteCompatibleSource
  //   ? Schema<RemoteSource<Src>>
  //   : never {
  //   // TODO: Schema<never, "Cannot create remote schema from non-remote source.">
  //   throw new Error("You need Val Ultra to use .remote()");
  // }

  /** MUTATES! since internal and perf sensitive */
  protected appendValidationError(
    current: ValidationErrors,
    path: SourcePath,
    message: string,
    value?: unknown,
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

export type SelectorOfSchema<T extends Schema<SelectorSource>> =
  T extends Schema<infer Src> ? Src : never; // TODO: SourceError<"Could not determine type of Schema">
