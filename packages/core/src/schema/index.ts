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
import { RawString, SerializedStringSchema } from "./string";
import { SerializedUnionSchema } from "./union";
import { SerializedCodeSchema } from "./code";
import { SerializedColorSchema } from "./color";
import { SerializedDateSchema } from "./date";
import { SerializedDateTimeSchema } from "./datetime";
import { SerializedLocaleSchema } from "./locale";
import { SerializedRouteSchema } from "./route";
import { SerializedSettingsSchema } from "./settings";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { FileSource } from "../source/media";
import { GenericRichTextSourceNode, RichTextSource } from "../source/richtext";
import { ReifiedPreview, PreviewScope, PreviewItem } from "../preview";
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
  | SerializedDateTimeSchema
  | SerializedColorSchema
  | SerializedCodeSchema
  | SerializedRouteSchema
  | SerializedLocaleSchema
  | SerializedSettingsSchema
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
/**
 * A locale scope's path, as something to read in a message.
 *
 * The walk names the item of an array or record `*`, which says nothing to
 * whoever has to fix this. `[]` is the convention people already read as "each
 * of these", and a path that is nothing BUT items has no field to name at all.
 */
function describeScopePath(path: string[]): string {
  if (path.every((segment) => segment === "*")) {
    return "its entries";
  }
  let rendered = "";
  for (const segment of path) {
    if (segment === "*") {
      rendered += "[]";
    } else {
      rendered += rendered === "" ? segment : `.${segment}`;
    }
  }
  return `'${rendered}'`;
}

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

  /**
   * Whether this node is a locale — the field that MARKS a scope, `s.locale()`.
   *
   * Only `LocaleSchema` overrides this. A base implementation rather than an
   * abstract one on purpose: every other schema class answers no, and a
   * question every class had to answer would be twenty edits for one yes.
   *
   * Not the same question as {@link opensLocaleScope}: a locale field marks the
   * scope, the object AROUND it is the scope. See `localeScope.ts`.
   */
  protected isLocaleField(): boolean {
    return false;
  }

  /**
   * Whether this node OPENS a locale scope, and what opens it.
   *
   * An object with a `s.locale()` field opens one; so does a record keyed by
   * `s.locale()`. Everything below such a node is in that one language, which
   * is why a scope may not contain another — see `localeScope.ts` for the rule
   * and the reason it is validated rather than typed.
   */
  protected opensLocaleScope(): "field" | "key" | null {
    return null;
  }

  /**
   * The child schemas a locale scope reaches, by the path segment that reaches
   * them.
   *
   * A structural walk that deliberately does NOT go through `executeSerialize`:
   * serializing a subtree at every node to ask a question about its shape is
   * quadratic, and this is asked during validation. `*` stands for the item of
   * an array or record, which has no name of its own.
   */
  protected localeScopeChildren(): {
    key: string;
    schema: Schema<SelectorSource>;
  }[] {
    return [];
  }

  /**
   * Every locale scope opened strictly BELOW this node, by path.
   *
   * Stops descending at each one it finds, so a scope three deep is reported
   * once, by the scope immediately enclosing it, rather than by every ancestor.
   */
  protected localeScopesBelow(
    prefix: string[] = [],
  ): { path: string[]; kind: "field" | "key" }[] {
    const found: { path: string[]; kind: "field" | "key" }[] = [];
    for (const { key, schema } of this.localeScopeChildren()) {
      const path = [...prefix, key];
      const opened = schema.opensLocaleScope();
      if (opened !== null) {
        found.push({ path, kind: opened });
        continue;
      }
      found.push(...schema.localeScopesBelow(path));
    }
    return found;
  }

  /**
   * The scope rule, as errors at this node — or `false` if it is not broken.
   *
   * Two things are wrong and both are wrong in the SCHEMA rather than in the
   * content, so both are `schemaError`s: an object with two locale fields (the
   * subtree below it would be in two languages at once), and a locale scope
   * inside another (the inner one would silently override the outer for part
   * of a subtree that is supposed to be one language throughout).
   *
   * Validated rather than typed on purpose. Expressing "no scope below this
   * one" as a constraint means threading it through every schema class's type
   * parameter, and the errors that fall out of a recursive constraint like
   * that name the whole tree — an unrelated typo in a `.val.ts` would print
   * pages. See the design notes on the locales PR.
   */
  protected localeScopeErrors(): ValidationError[] {
    const errors: ValidationError[] = [];
    const localeFields = this.localeFieldNames();
    if (localeFields.length > 1) {
      errors.push({
        message: `An object can be in one language, so it can have one locale field. Found ${localeFields
          .map((each) => `'${each}'`)
          .join(", ")}.`,
        schemaError: true,
      });
    }
    const opened = this.opensLocaleScope();
    if (opened !== null) {
      for (const nested of this.localeScopesBelow()) {
        errors.push({
          message: `Everything here is already in one language, so ${describeScopePath(
            nested.path,
          )} cannot set another. Move the ${
            nested.kind === "key" ? "locale-keyed record" : "locale field"
          } out of this ${
            opened === "key" ? "locale-keyed record" : "object"
          }, or take the outer one away.`,
          schemaError: true,
        });
      }
    }
    return errors;
  }

  /**
   * This node's own `s.locale()` fields, where it is an object that has any.
   *
   * Empty everywhere else, so `localeScopeErrors` can live on the base class.
   */
  protected localeFieldNames(): string[] {
    return [];
  }

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
   *
   * The flag defaults to `true`, so `.readonly()` and `.readonly(true)` are the
   * same thing. `.readonly(false)` leaves the field editable, which is what a
   * schema is anyway - pass it when the decision comes from a variable.
   */
  abstract readonly(isReadonly?: boolean): Schema<Src>;
  /**
   * Hide this field from the Val editor.
   *
   * This is a UI-only flag: the field is not rendered in the editor, but the
   * value is still stored, validated and serialized as normal.
   *
   * The flag defaults to `true`, so `.hidden()` and `.hidden(true)` are the
   * same thing. `.hidden(false)` leaves the field visible, which is what a
   * schema is anyway - pass it when the decision comes from a variable.
   */
  abstract hidden(isHidden?: boolean): Schema<Src>;
  protected abstract executeSerialize(): SerializedSchema;
  /**
   * @param scope Which paths the caller needs a preview for. Absent means the
   * whole module, which is what every caller passed before scoping existed.
   * See {@link PreviewScope}: a container prunes recursion where nothing is
   * wanted, and previews a WINDOW when its own path is not wanted but some of
   * its items are — which is the single-visible-row case.
   */
  protected abstract executePreview(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
    scope?: PreviewScope,
  ): ReifiedPreview;
  /**
   * This value AS A PREVIEW — what a container's row, a reference dropdown or
   * a search hit shows for it. Runs the schema's own `preview` closure;
   * `null` when none is declared (the consumer falls back to a generic
   * preview). A union dispatches to the matching member's closure.
   *
   * Containers call this on their ITEM schema per item — that is how
   * `executePreview` reifies an {@link ArrayPreview} / {@link RecordPreview}
   * from item-level declarations.
   */
  protected executePreviewItem(src: NonNullable<Src>): PreviewItem | null {
    // Default for schemas without a closure; every class that stores a
    // `previewInput` overrides both this and {@link declaresItemPreview}.
    void src;
    return null;
  }
  /**
   * Could {@link executePreviewItem} ever answer? A container reifies a rows
   * preview only when its item schema says yes — asked here rather than by
   * running the closure, so an EMPTY list still previews as an empty list
   * instead of not at all.
   */
  protected declaresItemPreview(): boolean {
    return false;
  }
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
