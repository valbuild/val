import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { LocaleAliases } from "../locale";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedLocaleSchema = {
  type: "locale";
  /**
   * How this field's locales are spelled where they are stored.
   *
   * Carried in the serialization because the Studio and the validation worker
   * both need it and neither has the schema instance — which is also why it is
   * a table rather than a function. See `LocaleAliases`.
   */
  aliases?: Record<string, string[]>;
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * One of the languages the project publishes.
 *
 * The set is NOT here. It is declared in the settings module — `locales.available`
 * — so that adding a language is something the people who write the content can
 * do, and so that one list drives validation, the Studio's picker and the
 * translation notes. This schema knows only that the value is one of them, which
 * is checked cross-module through the `locale:check-locale` fix, exactly as
 * `keyOf` and `route` check theirs.
 *
 * Never stega encoded (see `stegaEncode.ts`): a locale goes into `<html lang>`,
 * into `hreflang` and into `Intl` constructors, none of which survive invisible
 * characters.
 */
export class LocaleSchema<Src extends string | null> extends Schema<Src> {
  /**
   * Type-only marker: as a record key, this schema DECLARES the key set.
   *
   * `declare` so it exists in the type and nowhere at runtime — reading it off
   * an instance gives `undefined`, and nothing should. It is how `record()`
   * knows to type entries as `Item | null`: a language nobody has translated
   * into is a null entry, not an absent key. See `DeclaredKeySet` and
   * `RecordSrcOf`.
   */
  declare readonly __declaresRecordKeys: true;

  constructor(
    private readonly aliasMap?: LocaleAliases,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: ((
      src: Src,
    ) => false | string)[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  /**
   * Spell these locales differently where this field's value is stored.
   *
   * ```typescript
   * s.locale().aliases({ "en-US": "en", "nb-NO": "no" })      // stored: "en" | "no"
   * s.locale().aliases({ "en-US": ["us-sales", "us-support"] }) // several, one locale
   * ```
   *
   * The aliases REPLACE the tag rather than adding to it: with the first of
   * those, `"nb-NO"` is no longer a value this field accepts. If both were
   * accepted, one page could exist at `/no/foo` and at `/nb-NO/foo` — two keys
   * for one language, and duplicate content nobody would notice.
   *
   * A partial map is a subset. Saying nothing about `fr-FR` means this field has
   * no French, which is how a router for a bilingual section says so.
   *
   * Every locale named here should be one of `locales.available`; aliasing a
   * language the project does not have is how `/de/…` quietly becomes German on
   * a site with no German.
   */
  aliases<const M extends LocaleAliases>(map: M): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      map,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  describe(description: string | null): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.aliasMap,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.aliasMap,
      this.opt,
      this.customValidateFunctions.concat(validationFunction),
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    return {
      [path]: [
        ...customValidationErrors,
        {
          // Which languages exist is in another module, so this cannot be
          // answered here — the same shape `keyOf` and `route` use, resolved by
          // `resolveSchemaSourceFixes` against the settings module.
          fixes: ["locale:check-locale"],
          message: `Did not validate locale. This error (locale:check-locale) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
          value: {
            locale: src,
            sourcePath: path,
            aliases: this.serializedAliases(),
          },
        },
      ],
    };
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return { success: true, data: src } as SchemaAssertResult<Src>;
    }
    if (typeof src === "string") {
      return { success: true, data: src } as SchemaAssertResult<Src>;
    }
    return {
      success: false,
      errors: {
        [path]: [
          {
            message: `Expected 'string', got '${typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  nullable(): LocaleSchema<Src | null> {
    // Asserted whole, exactly as `RouteSchema.nullable` does: the source type
    // widens by `null` while the caller's validators and preview stay typed
    // against the value, and `executeValidate` returns before either sees one.
    return new LocaleSchema(
      this.aliasMap,
      true,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    ) as unknown as LocaleSchema<Src | null>;
  }

  readonly(): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.aliasMap,
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.aliasMap,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected override isLocaleField(): boolean {
    return true;
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
   * How this field is laid out where it is the item of an array or a record.
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.aliasMap,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
      this.previewInput,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   */
  preview(select: ItemPreviewInput<Src>): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.aliasMap,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      select,
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

  /** The alias table as JSON: every locale's spellings, as an array. */
  private serializedAliases(): Record<string, string[]> | undefined {
    if (this.aliasMap === undefined) {
      return undefined;
    }
    const serialized: Record<string, string[]> = {};
    for (const [locale, spellings] of Object.entries(this.aliasMap)) {
      serialized[locale] =
        typeof spellings === "string" ? [spellings] : [...spellings];
    }
    return serialized;
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "locale",
      aliases: this.serializedAliases(),
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

/**
 * Define one of the project's languages.
 *
 * The languages themselves are declared in the settings module, under
 * `locales.available` — this says only that a value is one of them.
 *
 * @example // a field: everything under this object is in this language
 * const schema = s.object({ locale: s.locale(), title: s.string() });
 *
 * @example // a key: one entry per language
 * const schema = s.record(s.locale(), s.object({ title: s.string() }));
 *
 * @example // stored as a short URL segment instead of the tag
 * const schema = s.locale().aliases({ "en-US": "en", "nb-NO": "no" });
 */
export const locale = (): LocaleSchema<string> => {
  return new LocaleSchema<string>();
};
