import {
  AssertError,
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
} from ".";
import { ItemPreviewInput, PreviewItem } from "../preview";
import { SourcePath } from "../val";
import { localeTagError } from "../locale";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedEnumSchema = {
  type: "enum";
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  /**
   * Every value this field may take, in declaration order — which is the order
   * the editor's dropdown offers them in.
   */
  values: string[];
  /**
   * Set by `.locales(...)`: the project language each value MEANS, by value.
   * Its presence is what makes this enum a locale — see `EnumSchema.locales`.
   */
  locales?: Record<string, string>;
  /**
   * Set by `.locales(..., { null: tag })`: the language of a URL that leaves
   * this route parameter out. Only meaningful on a router parameter.
   */
  nullLocale?: string;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * One of a fixed set of strings.
 *
 * The values are the schema — there are no member schemas to descend into, so
 * this is a LEAF, like `s.string()` with a closed domain. That is the whole
 * difference from {@link DiscriminatedUnionSchema}, and the reason the two are
 * separate: everything that walks a schema tree has to recurse into a
 * discriminated union's variants and must not try to recurse into these.
 */
export class EnumSchema<Src extends string | null> extends Schema<Src> {
  /**
   * Type-only marker: as a record key, this declares the key set.
   *
   * An enum names every value it may take, so a record keyed by one holds
   * exactly those keys — the same claim `s.literal()` and `s.locale()` make.
   * `DiscriminatedUnionSchema` carries no marker: it discriminates objects and
   * cannot be a record key at all. See `LocaleSchema`.
   */
  declare readonly __declaresRecordKeys: true;

  constructor(
    private readonly values: readonly string[],
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
    /** Set by `.locales(...)`: the language each value means. */
    private readonly localeMap: Readonly<Record<string, string>> | null = null,
    /** Set by `.locales(..., { null })`: the language of a missing segment. */
    private readonly nullLocale: string | null = null,
  ) {
    super();
  }

  /**
   * Describe this field.
   *
   * The description is INPUT HELP: it is shown where this field's value is
   * entered — beside its input in the Val editor, and for a record's key
   * schema in every form that asks for a key — so it is where you say what an
   * editor needs to know to fill it in RIGHT, which the field name cannot
   * carry. It is not a name for the value: that is `.preview(...)`, and it is
   * read somewhere else. The description also travels in the serialized
   * schema, which is what the AI assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s
   *   .enum("draft", "published")
   *   .describe("Only published pages are built");
   * export default c.define("/example.val.ts", schema, "draft");
   */
  describe(description: string | null): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.previewInput,
      this.localeMap,
      this.nullLocale,
    );
  }

  /**
   * Add a custom validation rule to this field.
   *
   * The function is called with the field's value and returns `false` when the
   * value is fine, or a STRING with the message to show when it is not. Call it
   * more than once to add more rules — they all run, and every message is
   * reported.
   *
   * Validation runs in the Studio as you type, in `npx val validate` and before a
   * publish.
   *
   * @example
   * const schema = s
   *   .enum("draft", "published")
   *   .validate((val) =>
   *     val === "published" ? "Publishing is frozen this week" : false,
   *   );
   * export default c.define("/example.val.ts", schema, "draft");
   */
  validate(validationFunction: (src: Src) => false | string): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions.concat(validationFunction),
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.localeMap,
      this.nullLocale,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    return this.validateAs(path, src, "field");
  }

  /**
   * Validate the value a URL gives a route parameter — see
   * `s.router(router, params, item)`.
   *
   * Not `executeValidate`, because one thing is right here that is wrong on a
   * field: `{ null: tag }`. A URL that leaves out an optional segment has a
   * language someone chose; a field that holds `null` has none, and Val does
   * not guess one for it.
   */
  protected validateRouteParam(path: SourcePath, src: Src): ValidationErrors {
    return this.validateAs(path, src, "route-param");
  }

  private validateAs(
    path: SourcePath,
    src: Src,
    as: "field" | "route-param",
  ): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    // The custom validators always report, whatever the structural answer is.
    const errors: ValidationError[] = [
      ...customValidationErrors,
      ...this.localeMappingErrors(),
    ];
    if (as === "field" && this.nullLocale !== null) {
      errors.push({
        message: `'{ null: "${this.nullLocale}" }' gives a URL without this segment a language, so it belongs on a router parameter: s.router(router, { locale: … }, item). On a field, null means nobody has chosen a language — use s.locale().nullable() there.`,
        schemaError: true,
      });
    }
    const unknownSrc = src as unknown;
    if (this.opt && (unknownSrc === null || unknownSrc === undefined)) {
      if (as === "route-param" && this.localeMap !== null) {
        if (this.nullLocale === null) {
          errors.push({
            message: `This URL leaves the language out, and nothing says which language that is. Add it to .locales(): .locales({ … }, { null: "en-US" })`,
            value: src,
          });
        } else {
          errors.push(this.checkLocale(path, this.nullLocale));
        }
      }
      return errors.length > 0 ? { [path]: errors } : false;
    }
    if (!Array.isArray(this.values) || this.values.length === 0) {
      errors.push({
        message: `An enum schema must have at least one value`,
        schemaError: true,
      });
    } else if (typeof unknownSrc !== "string") {
      errors.push({
        message: `Expected 'string', got '${
          unknownSrc === null ? "null" : typeof unknownSrc
        }'`,
        value: src,
        typeError: true,
      });
    } else if (!this.values.includes(unknownSrc)) {
      errors.push({
        message: `Value must be one of the following: ${this.values
          .map((value) => `"${value}"`)
          .join(", ")}`,
        value: src,
      });
    } else if (this.localeMap !== null) {
      const tag = this.localeMap[unknownSrc];
      if (typeof tag === "string") {
        errors.push(this.checkLocale(path, tag));
      }
    }
    return errors.length > 0 ? { [path]: errors } : false;
  }

  /**
   * The cross-module half of the check: is `tag` one of the project's
   * languages? The same deferred error `s.locale()` reports, resolved by
   * `resolveSchemaSourceFixes` against `locales.available` — so a mapped
   * value and a written-out tag are checked by one implementation.
   */
  private checkLocale(path: SourcePath, tag: string): ValidationError {
    return {
      fixes: ["locale:check-locale"],
      message: `Did not validate locale. This error (locale:check-locale) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
      value: {
        locale: tag,
        sourcePath: path,
      },
    };
  }

  /**
   * What is wrong with the mapping itself, whatever the value is.
   *
   * The compiler checks all of this for a schema written in TypeScript except
   * the spelling and the uniqueness of the tags; the rest is here for a schema
   * that came back from JSON.
   */
  protected localeMappingErrors(): ValidationError[] {
    if (this.localeMappingErrorsMemo === undefined) {
      this.localeMappingErrorsMemo = this.computeLocaleMappingErrors();
    }
    return this.localeMappingErrorsMemo;
  }

  private localeMappingErrorsMemo?: ValidationError[];

  private computeLocaleMappingErrors(): ValidationError[] {
    if (this.localeMap === null) {
      return [];
    }
    const errors: ValidationError[] = [];
    const mapped = Object.entries(this.localeMap);
    for (const value of this.values) {
      if (!(value in this.localeMap)) {
        errors.push({
          message: `.locales() does not say which language "${value}" is`,
          schemaError: true,
        });
      }
    }
    for (const [value] of mapped) {
      if (!this.values.includes(value)) {
        errors.push({
          message: `.locales() names "${value}", which is not one of this enum's values`,
          schemaError: true,
        });
      }
    }
    const tags =
      this.nullLocale === null
        ? mapped.map(([, tag]) => tag)
        : [...mapped.map(([, tag]) => tag), this.nullLocale];
    for (const tag of tags) {
      const error = localeTagError(tag);
      if (error) {
        errors.push({ message: error, schemaError: true });
      }
    }
    const seen = new Set<string>();
    for (const tag of tags) {
      if (seen.has(tag)) {
        // Two spellings of one language would give one page two URLs in that
        // language, and nothing could say which of them the translations of
        // the page are translations of.
        errors.push({
          message: `'${tag}' is in .locales() twice. Each language has one spelling, so a page has one URL per language.`,
          schemaError: true,
        });
      }
      seen.add(tag);
    }
    return errors;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    const errors: Record<SourcePath, AssertError[]> = {};
    if (typeof src !== "string") {
      errors[path] = [
        {
          message: `Expected 'string', got '${src === null ? "null" : typeof src}'`,
          typeError: true,
        },
      ];
      return { success: false, errors };
    }
    if (!Array.isArray(this.values) || this.values.length === 0) {
      errors[path] = [
        {
          message: `An enum schema must have at least one value`,
          schemaError: true,
        },
      ];
      return { success: false, errors };
    }
    if (!this.values.includes(src)) {
      errors[path] = [
        {
          message: `Expected one of ${this.values
            .map((value) => `'${value}'`)
            .join(", ")}, got '${src}'`,
          typeError: true,
        },
      ];
      return { success: false, errors };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): EnumSchema<Src | null> {
    // Explicit type args: `previewInput` would otherwise pin inference to `Src`.
    return new EnumSchema<Src | null>(
      this.values,
      true,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.localeMap,
      this.nullLocale,
    );
  }

  readonly(isReadonly: boolean = true): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.localeMap,
      this.nullLocale,
    );
  }

  hidden(isHidden: boolean = true): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.previewInput,
      this.localeMap,
      this.nullLocale,
    );
  }

  /**
   * Say which of the project's languages each value MEANS — which makes this
   * enum a locale, the way `s.locale()` is one.
   *
   * For a value that is not a language tag itself: most often a route
   * parameter, where a site writes `/nb/…` and means `nb-NO`. The values are
   * what is stored (and what is in the URL); the tags on the right are what
   * they mean, and those are checked against `locales.available` in the
   * settings module exactly as an `s.locale()` value is.
   *
   * On a nullable enum it takes an optional second argument, `{ null: tag }`:
   * the language of a URL that leaves the segment out, which is how a site
   * serves its default language without a prefix. That is ONLY for a router
   * parameter, where leaving it out of a nullable one is reported on every URL
   * without the segment. On a field `null` means nobody chose a language, and
   * saying which one it "really" is would file content under a language
   * nobody picked, so there it is a schema error.
   *
   * One spelling per language: two values (or a value and `null`) that mean
   * the same tag would give one page two URLs in that language.
   *
   * @example // a route parameter: `/about` is English, `/nb/about` Norwegian
   * import { tanstackRouter } from "../val.config";
   * const urlLocale = s
   *   .enum("nb")
   *   .nullable()
   *   .locales({ nb: "nb-NO" }, { null: "en-US" });
   * const schema = s.router(
   *   tanstackRouter,
   *   { locale: urlLocale },
   *   s.object({ title: s.string() }),
   * );
   * export default c.define("/src/routes/{-$locale}.about.val.ts", schema, {
   *   "/about": { title: "About us" },
   *   "/nb/about": { title: "Om oss" },
   * });
   *
   * @example // a field that stores a short code
   * const schema = s.object({
   *   language: s.enum("en", "nb").locales({ en: "en-US", nb: "nb-NO" }),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   language: "nb",
   *   title: "Vinterjakke",
   * });
   */
  locales(
    locales: { readonly [Value in NonNullable<Src>]: string },
    ...whenNull: null extends Src ? [whenNull?: { null: string }] : []
  ): EnumSchema<Src> {
    const nullOption: { null: string } | undefined = whenNull[0];
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      { ...locales },
      nullOption?.null ?? null,
    );
  }

  /**
   * The language of a URL that leaves this parameter out, where one was given.
   * For `RecordSchema`, which checks that the route can leave it out at all.
   */
  protected routeParamNullLocale(): string | null {
    return this.nullLocale;
  }

  /**
   * Whether `.locales(...)` made this enum a language. If so, an object with
   * it as a field is in that language, the same as one with `s.locale()`.
   */
  protected override isLocaleField(): boolean {
    return this.localeMap !== null;
  }

  protected override executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[] {
    return this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * @example
   * const schema = s.array(
   *   s.enum("draft", "published").preview(({ val }) => ({ title: val })),
   * );
   * export default c.define("/example.val.ts", schema, ["draft"]);
   */
  preview(select: ItemPreviewInput<Src>): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      select,
      this.localeMap,
      this.nullLocale,
    );
  }

  protected override executePreviewItem(
    src: NonNullable<Src>,
  ): PreviewItem | null {
    if (this.previewInput === null) {
      return null;
    }
    return this.previewInput({ val: src });
  }

  protected override declaresItemPreview(): boolean {
    return this.previewInput !== null;
  }

  protected executeSerialize(): SerializedEnumSchema {
    return {
      type: "enum",
      preview: this.previewInput ? true : undefined,
      values: [...this.values],
      ...(this.localeMap !== null ? { locales: { ...this.localeMap } } : {}),
      ...(this.nullLocale !== null ? { nullLocale: this.nullLocale } : {}),
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }
}

/**
 * Define a string that must be one of a fixed set of values.
 *
 * Named `enumSchema` rather than `enum` because `enum` is a reserved word and
 * cannot be a binding name; it is exposed as `s.enum`.
 */
export const enumSchema = <T extends string>(
  ...values: [T, ...T[]]
): EnumSchema<T> => {
  return new EnumSchema<T>(values);
};
