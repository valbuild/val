import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedLocaleSchema = {
  type: "locale";
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
   * A note to whoever edits this field, shown under it in the Studio.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s.object({
   *   locale: s.locale().describe("The language everything below is written in"),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   locale: "nb-NO",
   *   title: "Vinterjakke",
   * });
   */
  describe(description: string | null): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  /**
   * A check of your own, on top of "is this one of the project's languages".
   *
   * Return a message when the value is WRONG and `false` when it is fine — the
   * two answers are a complaint and no complaint, so write the check as a
   * ternary rather than as `ok || "message"`, which returns `true` and `true`
   * is neither.
   *
   * @example
   * const schema = s.object({
   *   locale: s.locale().validate((val) =>
   *     val === "en-US" ? "This section is not translated into English yet" : false,
   *   ),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   locale: "nb-NO",
   *   title: "Vinterjakke",
   * });
   */
  validate(
    validationFunction: (src: Src) => false | string,
  ): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
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
   *
   * @example
   * const schema = s.array(s.locale().render({ as: "inline" }));
   * export default c.define("/example.val.ts", schema, ["nb-NO", "en-US"]);
   */
  render(input: FieldRender): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
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
   *
   * @example
   * const schema = s.array(
   *   s.locale().preview(({ val }) => ({ title: val })),
   * );
   * export default c.define("/example.val.ts", schema, ["nb-NO", "en-US"]);
   */
  preview(select: ItemPreviewInput<Src>): LocaleSchema<Src> {
    return new LocaleSchema<Src>(
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

  protected executeSerialize(): SerializedSchema {
    return {
      type: "locale",
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
 */
export const locale = (): LocaleSchema<string> => {
  return new LocaleSchema<string>();
};
