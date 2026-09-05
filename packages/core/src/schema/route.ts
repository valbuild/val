import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { SourcePath } from "../val";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type RouteOptions = {
  include?: RegExp;
  exclude?: RegExp;
};

export type SerializedRouteSchema = {
  type: "route";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: {
    include?: {
      source: string;
      flags: string;
    };
    exclude?: {
      source: string;
      flags: string;
    };
    customValidate?: boolean;
  };
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class RouteSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: RouteOptions,
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

  describe(description: string | null): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
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
   * Specify a pattern for which routes are allowed.
   *
   * Semantics:
   * - If only include is set: route must match include pattern
   * - If only exclude is set: route must NOT match exclude pattern
   * - If both are set: route must match include AND must NOT match exclude
   *
   * @example
   * s.route().include(/^\/(home|about|contact)$/)  // Only these specific routes
   * s.route().include(/^\/api\//).exclude(/^\/api\/internal\//)  // API routes except internal
   */
  include(pattern: RegExp): RouteSchema<Src> {
    return new RouteSchema<Src>(
      { ...this.options, include: pattern },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  /**
   * Specify a pattern for which routes should be excluded.
   *
   * Semantics:
   * - If only include is set: route must match include pattern
   * - If only exclude is set: route must NOT match exclude pattern
   * - If both are set: route must match include AND must NOT match exclude
   *
   * @example
   * s.route().exclude(/^\/admin/)  // Exclude all admin routes
   * s.route().include(/^\/api\//).exclude(/^\/api\/internal\//)  // API routes except internal
   */
  exclude(pattern: RegExp): RouteSchema<Src> {
    return new RouteSchema<Src>(
      { ...this.options, exclude: pattern },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  validate(validationFunction: (src: Src) => false | string): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
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
          fixes: ["router:check-route"],
          message: `Did not validate route (router). This error (router:check-route) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
          value: {
            route: src,
            sourcePath: path,
            include: this.options?.include,
            exclude: this.options?.exclude,
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
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    if (typeof src === "string") {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
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

  nullable(): RouteSchema<Src | null> {
    return new RouteSchema(
      this.options,
      true,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    ) as unknown as RouteSchema<Src | null>;
  }

  readonly(isReadonly: boolean = true): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
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
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
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
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   */
  preview(select: ItemPreviewInput<Src>): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
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
      type: "route",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      options: {
        include: this.options?.include && {
          source: this.options.include.source,
          flags: this.options.include.flags,
        },
        exclude: this.options?.exclude && {
          source: this.options.exclude.source,
          flags: this.options.exclude.flags,
        },
        customValidate:
          this.customValidateFunctions &&
          this.customValidateFunctions?.length > 0,
      },
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

export const route = <T extends string>(
  options?: Record<string, never>,
): RouteSchema<T> => {
  return new RouteSchema(options);
};
