import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender } from "../render";
import { SourcePath } from "../val";
import { RawString } from "./string";
import { ValidationErrors } from "./validation/ValidationError";

type DateTimeOptions = {
  /**
   * Validate that the datetime is this datetime or after (inclusive).
   *
   * Accepts any ISO 8601 datetime string parseable by `Date.parse`.
   *
   * @example
   * 2021-01-01T00:00:00Z
   */
  from?: string;
  /**
   * Validate that the datetime is this datetime or before (inclusive).
   *
   * Accepts any ISO 8601 datetime string parseable by `Date.parse`.
   *
   * @example
   * 2021-12-31T23:59:59Z
   */
  to?: string;
};

export type SerializedDateTimeSchema = {
  type: "dateTime";
  options?: DateTimeOptions;
  opt: boolean;
  customValidate?: boolean;
};

export class DateTimeSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: DateTimeOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): DateTimeSchema<Src> {
    return new DateTimeSchema(this.options, this.opt, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    const srcMs = Date.parse(src);
    if (Number.isNaN(srcMs)) {
      return {
        [path]: [
          {
            message: `Value '${src}' is not a valid ISO 8601 datetime`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    const fromMs =
      this.options?.from !== undefined
        ? Date.parse(this.options.from)
        : undefined;
    const toMs =
      this.options?.to !== undefined ? Date.parse(this.options.to) : undefined;
    if (fromMs !== undefined && Number.isNaN(fromMs)) {
      return {
        [path]: [
          {
            message: `From datetime '${this.options?.from}' is not a valid ISO 8601 datetime`,
            value: src,
            typeError: true,
          },
        ],
      } as ValidationErrors;
    }
    if (toMs !== undefined && Number.isNaN(toMs)) {
      return {
        [path]: [
          {
            message: `To datetime '${this.options?.to}' is not a valid ISO 8601 datetime`,
            value: src,
            typeError: true,
          },
        ],
      } as ValidationErrors;
    }
    if (fromMs !== undefined && toMs !== undefined) {
      if (fromMs > toMs) {
        return {
          [path]: [
            {
              message: `From datetime ${this.options?.from} is after to datetime ${this.options?.to}`,
              value: src,
              typeError: true,
            },
          ],
        } as ValidationErrors;
      }
      if (srcMs < fromMs || srcMs > toMs) {
        return {
          [path]: [
            {
              message: `Datetime is not between ${this.options?.from} and ${this.options?.to}`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    } else if (fromMs !== undefined) {
      if (srcMs < fromMs) {
        return {
          [path]: [
            {
              message: `Datetime is before the minimum datetime ${this.options?.from}`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    } else if (toMs !== undefined) {
      if (srcMs > toMs) {
        return {
          [path]: [
            {
              message: `Datetime is after the maximum datetime ${this.options?.to}`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    }
    return false;
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
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: "Expected 'string', got 'null'",
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src !== "string") {
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

    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  from(from: string): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>({ ...this.options, from }, this.opt);
  }

  to(to: string): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>({ ...this.options, to }, this.opt);
  }

  nullable(): DateTimeSchema<Src | null> {
    return new DateTimeSchema<Src | null>(this.options, true);
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "dateTime",
      opt: this.opt,
      options: this.options,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const datetime = (
  options?: Record<string, never>,
): DateTimeSchema<RawString> => {
  return new DateTimeSchema(options);
};
