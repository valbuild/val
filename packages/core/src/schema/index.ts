// import { RemoteCompatibleSource, RemoteSource } from "../source/remote";
import { SelectorSource } from "../selector";
import { ModuleFilePath, SourcePath } from "../val";
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
import { SerializedSvgSchema } from "./svg";
import { RawString, SerializedStringSchema } from "./string";
import { SerializedUnionSchema } from "./union";
import { SerializedColorSchema } from "./color";
import { SerializedDateSchema } from "./date";
import { SerializedDateTimeSchema } from "./datetime";
import { SerializedRouteSchema } from "./route";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { FileSource } from "../source/file";
import { GenericRichTextSourceNode, RichTextSource } from "../source/richtext";
import { GenericSvgSource, SvgOptions, SvgSource } from "../source/svg";
import { ReifiedRender } from "../render";
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
  | SerializedSvgSchema
  | SerializedRecordSchema
  | SerializedKeyOfSchema
  | SerializedFileSchema
  | SerializedDateSchema
  | SerializedDateTimeSchema
  | SerializedColorSchema
  | SerializedRouteSchema
  | SerializedImageSchema;

type Primitives = number | string | boolean | null | FileSource;
export type AssertError =
  | {
      message: string;
      schemaError: true;
    }
  | {
      message: string;
      typeError: true;
    }
  | {
      message: string;
      internalError: true;
    };
export type SchemaAssertResult<Src extends SelectorSource> =
  | {
      // It would be more elegant if we derived this in the individual schema classes, however we must support the case when the abstract class is the only thing available (Schema<string[]> does not dispatch on type-level to ArraySchema)
      data: Src extends RawString
        ? string
        : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
          Src extends RichTextSource<{}>
          ? GenericRichTextSourceNode[]
          : Src extends SvgSource<SvgOptions>
            ? GenericSvgSource
            : Src extends Primitives
              ? Src
              : Src extends Array<SelectorSource>
                ? SelectorSource[]
                : Src extends { [key: string]: SelectorSource }
                  ? { [key in keyof Src]: SelectorSource }
                  : never;
      success: true;
    }
  | { success: false; errors: Record<SourcePath, AssertError[]> };
export type CustomValidateFunction<Src extends SelectorSource> = (
  src: Src,
  ctx: { path: SourcePath },
) => false | string;
export abstract class Schema<Src extends SelectorSource> {
  /** Validate the value of source content */
  protected abstract executeValidate(
    path: SourcePath,
    src: Src,
  ): ValidationErrors;
  /**
   * Runs the custom validate functions declared on THIS node (not its children)
   * against `src`.
   *
   * Abstract because every schema class holds its validators in its own
   * `private readonly customValidateFunctions`, which no base implementation can
   * reach — and a base implementation returning `[]` would let a class that
   * forgot to implement this silently skip its user's validators. A compile error
   * is the better failure.
   *
   * `src` stays a PARAMETER (as in {@link executeValidate}) rather than the
   * functions being returned: `CustomValidateFunction<Src>` puts `Src` in a
   * parameter position, so returning them would make `Schema<Src>` invariant and
   * break every `Schema<Source>` → `Schema<SelectorSource>` assignment in the
   * codebase.
   *
   * Deliberately independent of `executeValidate`: the Studio gets its structural
   * errors from a worker, which holds a DESERIALIZED schema where user functions
   * cannot survive, and then executes the custom validators on the main thread
   * against the real instance. Structural errors publish first; these merge in.
   */
  protected abstract executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[];

  protected executeCustomValidateFunctions(
    src: Src,
    customValidateFunctions: CustomValidateFunction<Src>[],
    ctx: { path: SourcePath },
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const customValidateFunction of customValidateFunctions) {
      try {
        const result = customValidateFunction(src, ctx);
        if (result) {
          errors.push({ message: result, value: src });
        }
      } catch (err) {
        errors.push({
          message: `Error in custom validate function: ${err instanceof Error ? err.message : String(err)}`,
          value: src,
          schemaError: true,
        });
      }
    }
    return errors;
  }
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
  protected abstract executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src>; // TODO: rename to parse? or _assert / _parse to indicate it is private? Or make protected (requires us to have some sort of calling it in the UX Val code)
  abstract nullable(): Schema<Src | null>;
  /**
   * Mark this field as read-only in the Val editor.
   *
   * This is a UI-only flag: the field is rendered disabled in the editor, but
   * the value is not otherwise validated or enforced differently.
   */
  abstract readonly(): Schema<Src>;
  /**
   * Hide this field from the Val editor.
   *
   * This is a UI-only flag: the field is not rendered in the editor, but the
   * value is still stored, validated and serialized as normal.
   */
  abstract hidden(): Schema<Src>;
  protected abstract executeSerialize(): SerializedSchema;
  protected abstract executeRender(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
  ): ReifiedRender;
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
    value: unknown,
    schemaError?: boolean,
  ): ValidationErrors {
    if (current) {
      if (current[path]) {
        current[path].push({ message, value, schemaError });
      } else {
        current[path] = [{ message, value, schemaError }];
      }
      return current;
    } else {
      return {
        [path]: [{ message, value, schemaError }],
      } as ValidationErrors;
    }
  }

  /**
   * Merges two sets of validation errors path-wise: errors on the same path are
   * concatenated, not overwritten. Object spread cannot be used for this, since
   * it replaces the array of the colliding path. A record, for example, validates
   * the key and the item on the same path, so both sets must survive.
   *
   * MUTATES! since internal and perf sensitive
   */
  protected mergeValidationErrors(
    current: ValidationErrors,
    incoming: ValidationErrors,
  ): ValidationErrors {
    if (!incoming) {
      return current;
    }
    if (!current) {
      return incoming;
    }
    for (const pathS in incoming) {
      const path = pathS as SourcePath;
      if (current[path]) {
        current[path] = current[path].concat(incoming[path]);
      } else {
        current[path] = incoming[path];
      }
    }
    return current;
  }
}

export type SelectorOfSchema<T extends Schema<SelectorSource>> =
  T extends Schema<infer Src> ? Src : never; // TODO: SourceError<"Could not determine type of Schema">
